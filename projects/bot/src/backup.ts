import { dmServerHint, serverCommands, serverLabel, serverReply } from "./server-scope.ts"
import {
    BACKUP_CATEGORY_LIMITS,
    BACKUP_RESTORE_LIMITS,
    backupChannelSemantic,
    backupExclusions,
    backupSettingName,
    canonicalBackupJson,
} from "@neonflux/contracts/backup"
import { permissionNames } from "@neonflux/contracts/permission-names"
import type {
    BackupBinding,
    BackupCategory,
    BackupContext,
    BackupDisposition,
    BackupGrant,
    BackupItem,
    BackupItemState,
    BackupNativeProof,
    BackupPlan,
    BackupStructureObject,
} from "@neonflux/contracts/backup"
import {
    errors,
    ChannelType,
    format,
    type BotEventContext,
    type Client,
    type ChannelCreate,
    type ChannelEdit,
    type Message,
    text,
} from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit, Semaphore } from "effect"
import { createHash, randomUUID } from "node:crypto"
import type { BotConfig } from "./config.ts"
import { encryptBackupManifest, decryptBackupEnvelope } from "./backup-crypto.ts"
import { backupHelp, type BackupCommand } from "./backup-command.ts"
import { BackupAttachmentError, downloadBackupAttachment, uploadBackupAttachment } from "./backup-attachments.ts"
import {
    BackupPermissionError,
    captureBackupStructure,
    readBackupContext,
    readBackupEvidence,
    readBackupNativeProof,
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
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { ago, at, code, notSetUp, renderEmbeds, type Card, type RenderedReply } from "./reply-style.ts"

class BackupHandlingError extends Data.TaggedError("BackupHandlingError")<{
    readonly reason: "binding" | "expired" | "grant" | "snapshot" | "claim" | "capacity" | "archive"
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
/** The Owner and DM check of a page is the caller's `known` one, which renews itself as it ages. Without it every page reads them again */
function readPlanItems(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    plan: BackupPlan,
    dm: string,
    known?: Effect.Effect<BackupContext, BackupPermissionError>,
) {
    return Effect.gen(function* () {
        let cursor: string | undefined
        const items: BackupItem[] = [],
            cursors = new Set<string>()
        for (let page = 0; page < 25; page++) {
            const context = yield* known ?? readBackupContext(client, config.serverId, plan.ownerId, dm)
            const result = yield* store.query({
                serverId: config.serverId,
                context,
                operation: { type: "items", binding: backupBinding(plan), ...(cursor ? { cursor } : {}) },
            })
            if (result.type !== "items") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            items.push(...result.items)
            if (!result.nextCursor) {
                if (items.length !== plan.itemCount || new Set(items.map((i) => i.itemNo)).size !== items.length)
                    return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                return items.sort((a, b) => a.itemNo - b.itemNo)
            }
            if (cursors.has(result.nextCursor))
                return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            cursors.add(result.nextCursor)
            cursor = result.nextCursor
        }
        return yield* Effect.fail(new BackupHandlingError({ reason: "capacity" }))
    })
}
function readOriginMappings(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    ownerId: string,
    dm: string,
    provider: string,
    known?: Effect.Effect<BackupContext, BackupPermissionError>,
) {
    return Effect.gen(function* () {
        const mappings = new Map<string, string>(),
            cursors = new Set<string>()
        let cursor: string | undefined
        for (let page = 0; page < 250; page++) {
            const context = yield* known ?? readBackupContext(client, config.serverId, ownerId, dm)
            const result = yield* store.query({
                serverId: config.serverId,
                context,
                operation: { type: "origins", provider, ...(cursor ? { cursor } : {}) },
            })
            if (result.type !== "origins") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            for (const origin of result.origins)
                if (origin.category === "structure" && origin.mappedId) mappings.set(origin.sourceId, origin.mappedId)
            if (!result.nextCursor) return mappings
            if (cursors.has(result.nextCursor))
                return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            cursors.add(result.nextCursor)
            cursor = result.nextCursor
        }
        return yield* Effect.fail(new BackupHandlingError({ reason: "capacity" }))
    })
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
        if (
            work &&
            (result.plan.confirmedAt === undefined || (yield* Clock.currentTimeMillis) >= result.plan.expiresAt)
        )
            return yield* Effect.fail(new BackupHandlingError({ reason: "expired" }))
        return result.plan
    })
}
const AUDIT = "Restored from a NeonFlux backup"
/** The edit that brings a channel from `from` to `to`, with only the settings that differ. The category moves apart */
export function nativeBackupEdit(from: BackupStructureObject, to: BackupStructureObject): ChannelEdit {
    const was = backupChannelSemantic(from),
        now = backupChannelSemantic(to),
        differs = (key: keyof typeof now) =>
            canonicalBackupJson(was[key] ?? null) !== canonicalBackupJson(now[key] ?? null)
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
 * discovery or replay. The first proof reuses the caller's reads of the server's authority, and a fresh Owner check after its reads backs the claim.
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
            const sound =
                grant.provider === plan.provider &&
                grant.serverId === config.serverId &&
                grant.ownerId === plan.ownerId &&
                grant.botId === context.botId &&
                grant.sourceId === object.sourceId &&
                grant.action === item.disposition &&
                grant.dispatchExpiresAt <= plan.expiresAt &&
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
            const patch = nativeBackupEdit(grant.from!, grant.channel)
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
/** How old the pass's Owner and DM check or the proof of its identical channels may get before it is read again. The backend refuses them after 60 seconds */
const PASS_READ_MS = 30_000
/**
 * The members that identical channels collected together may name in their permissions between them. Each is a read of its own that waits at
 * most 5 seconds, so a group stays inside the 30 seconds. A single channel that names more is collected alone and can take longer
 */
const BATCH_MEMBERS = 4
/** How old the pass's Owner and DM check may be when the identical channels are collected, so that the proof and the check are applied together */
const BATCH_CONTEXT_MS = 10_000
/**
 * One pass of a confirmed plan, up to 20 items. One Owner and DM check opens the pass, and its reads feed the plan check, the plan's items, the
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
            const items = yield* readPlanItems(store, config, client, plan, privateChannelId, renewedContext)
            const mappings = yield* readOriginMappings(
                store,
                config,
                client,
                plan.ownerId,
                privateChannelId,
                plan.provider,
                renewedContext,
            )
            for (const i of items) if (i.category === "structure" && i.mappedId) mappings.set(i.sourceId, i.mappedId)
            const results: { item: BackupItem; recorded: boolean; outcome: string }[] = []
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
                const value = yield* store.query({
                    serverId: config.serverId,
                    context: evidence.context,
                    operation: { type: "item", binding: backupItemBinding(item) },
                })
                if (value.type !== "item" || !value.object)
                    return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                let result: { item: BackupItem; recorded: boolean; outcome: string }
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
                    // Turning the cleanup module on resumes the archive's policies, so the proof reads their channels too
                    const resumed =
                        "family" in value.object && value.object.family === "cleanup"
                            ? items.filter((i) => i.family === "cleanupPolicy").map((i) => i.sourceId)
                            : []
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
                }
                results.push(result)
                if (item.category === "structure") {
                    // A channel write can change the channels that follow, so the identical ones are read again
                    identical = undefined
                    if (result.item.mappedId) mappings.set(item.sourceId, result.item.mappedId)
                }
            }
            return {
                results,
                remaining:
                    items.filter((i) => ["planned", "reserved"].includes(i.state)).length -
                    results.filter((r) => r.recorded).length,
            }
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
            const items = yield* readPlanItems(store, config, client, plan, privateChannelId),
                results: BackupItem[] = []
            const mappings = yield* readOriginMappings(
                store,
                config,
                client,
                plan.ownerId,
                privateChannelId,
                plan.provider,
            )
            for (const i of items) if (i.category === "structure" && i.mappedId) mappings.set(i.sourceId, i.mappedId)
            for (const item of items) {
                if (results.length >= 20) break
                if (
                    item.category !== "structure" ||
                    item.disposition !== "create" ||
                    !item.mappedId ||
                    item.resolution === "match" ||
                    !["claimed", "uncertain", "failed"].includes(item.state)
                )
                    continue
                const evidence = yield* readBackupEvidence(client, config.serverId, plan.ownerId, privateChannelId)
                const found = yield* store.query({
                    serverId: config.serverId,
                    context: evidence.context,
                    operation: { type: "item", binding: backupItemBinding(item) },
                })
                if (found.type !== "item" || !found.object || !("type" in found.object)) continue
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
        if (!objects.length) return objects
        const result = yield* store.query({
            serverId: config.serverId,
            context: yield* readBackupContext(client, config.serverId, message.author.id, message.channelId),
            operation: { type: "managed", channelIds: objects.map((o) => o.sourceId) },
        })
        if (result.type !== "managed") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
        const kinds = new Map(result.channels.map((x) => [x.id, x.managed] as const))
        return objects.map((o) => (kinds.has(o.sourceId) ? { ...o, managed: kinds.get(o.sourceId)! } : o))
    })
}
const keyMissing =
    "Backups are off because NeonFlux has no NEONFLUX_BACKUP_KEY. Set one in the bot's configuration and keep a copy offline. Never send keys in chat"
function readArchive(config: BotConfig, bytes: Uint8Array, provider: string) {
    return Effect.gen(function* () {
        const manifest = yield* Effect.try({
            try: () => validateBackupManifest(decryptBackupEnvelope(bytes, config.backupKey!)),
            catch: () => new BackupHandlingError({ reason: "archive" }),
        })
        if (manifest.provider !== provider || manifest.serverId !== config.serverId)
            return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
        return manifest
    })
}
/** The archive attached to an owner's DM message, and fresh native evidence of the server for every item a restore plan decides */
function readRestoreEvidence(store: BackupStore, config: BotConfig, client: Client, message: Message) {
    return Effect.gen(function* () {
        const provider = yield* providerFor(client),
            bytes = yield* downloadBackupAttachment(client, { serverId: config.serverId, message })
        const manifest = yield* readArchive(config, bytes, provider)
        // An archive that holds channels, or none at all after saving them, also reads the server's channel list
        const structure = manifest.selected.includes("structure")
        const mappings =
            structure || manifest.config.length
                ? yield* readOriginMappings(store, config, client, message.author.id, message.channelId, provider)
                : new Map<string, string>()
        const native =
            manifest.config.length || structure
                ? yield* readBackupNativeProof(
                      client,
                      config.serverId,
                      yield* readBackupEvidence(client, config.serverId, message.author.id, message.channelId),
                      [...manifest.config, ...manifest.structure],
                      mappings,
                      [],
                      structure,
                  )
                : null
        const context = yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
        return { manifest, archiveDigest: createHash("sha256").update(bytes).digest("hex"), native, context }
    })
}
/**
 * The restore plan of an archive made now. A preview and a plan are the same thing: The backend stores the plan, replacing the earlier one
 * that was never confirmed, and the owner confirms exactly what was shown
 */
function makeBackupPlan(store: BackupStore, config: BotConfig, client: Client, message: Message, match: boolean) {
    return Effect.gen(function* () {
        const { manifest, archiveDigest, native, context } = yield* readRestoreEvidence(store, config, client, message)
        const { plan } = yield* store.preview({
            serverId: config.serverId,
            context,
            manifest,
            archiveDigest,
            native,
            archive: { channelId: message.channelId },
            match,
        })
        return plan
    })
}
const capital = (text: string) => text.replace(/^./, (letter) => letter.toUpperCase())
const familyNames: Partial<Record<string, string>> = {
    automod: "Automod rule",
    panel: "Role panel",
    ticketCategory: "Ticket category",
    metadata: "Metadata logs",
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
}) {
    if (i.category === "structure")
        return i.name ? `Channel **${i.name}**` : `Channel ${format.channelMention(i.mappedId ?? i.sourceId)}`
    if (i.category === "xp") return `XP of ${format.userMention(i.sourceId)}`
    if (i.family === "cleanupPolicy") return `Message cleanup in ${format.channelMention(i.sourceId)}`
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
    "event-definitions": "events",
    "schedule-definitions": "scheduled posts",
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
 * The items that start to delete messages or post logs, counted where the owner reads first, since their own lines may sit on a later page.
 * A channel delete has the line above, so it does not count here
 */
const effects = (items: readonly BackupItem[]) => {
    const n = items.filter((i) => i.warning && i.disposition !== "delete").length
    return n
        ? [
              `${n} ${n === 1 ? "item starts" : "items start"} to delete messages or post logs, see ${n === 1 ? "its" : "their"} line`,
          ]
        : []
}
/** What an item will do, with its changed fields, the permissions or switches it adds and its reason */
const planLine = (i: BackupItem) =>
    `${itemTarget(i)}: ${i.disposition === "skip" && i.reason ? "Left alone" : dispositions[i.disposition]}${i.disposition === "update" && i.changed?.length ? ` (${i.changed.map(backupSettingName).join(", ")})` : ""}${i.gain ? ", more permissions than now" : ""}${i.on ? ", turns a setting on" : ""}${i.reason ? `. ${i.reason}` : ""}${i.warning ? `. ${i.warning}` : ""}`
type PreviewFailure = "owner" | "archive" | "refused" | "error"
function previewFailure(error: unknown): PreviewFailure {
    if (error instanceof BackupPermissionError)
        return error.reason === "owner" || error.reason === "private" ? "owner" : "error"
    if (error instanceof BackupAttachmentError) return error.reason === "transport" ? "error" : "archive"
    if (error instanceof BackupStoreError) return error.status === 413 ? "refused" : "error"
    if (error instanceof BackupHandlingError || errors.isNotFound(error)) return "archive"
    return "error"
}
// NeonFlux accepts only the name pattern of the archives it sends, so a renamed copy is refused
const attachmentName =
    "Attach the .nfb file as NeonFlux sent it, with its name unchanged, such as neonflux-backup-archive.nfb. After neonflux-backup- a name may hold only letters, digits, - and _, so rename a copy such as neonflux-backup-archive (1).nfb first"
const previewFailureText: Record<PreviewFailure, string> = {
    owner: "Only the current server Owner can preview a restore, in a one-to-one DM with NeonFlux",
    archive: `The archive could not be read. Check that it belongs to this server and was made with the current backup key. ${attachmentName}`,
    refused:
        "A restore refuses this archive as a whole because it exceeds restore limits. Export fewer categories at a time",
    error: "The preview could not be made right now. Try again shortly",
}
const planCapacity = `This server already keeps ${BACKUP_RESTORE_LIMITS.plans} restore plans, the most it may keep. Every confirmed plan counts, forgotten ones too, for at least seven days after it expires, and longer while a created channel's outcome is unknown. A preview nobody confirmed is replaced by the next one. Preview again once an older plan is removed`
const matchTooBig =
    "Match would make a plan of more than 500 items with the channels and categories it deletes. Preview without match, or delete some of them first"
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
/** Whether an item needs the owner's attention: A blocked, conflicting or failed item, or a channel whose write was not confirmed */
const problem = (i: BackupItem) =>
    i.disposition === "blocked" ||
    ["conflict", "blocked", "failed"].includes(i.state) ||
    (i.state === "uncertain" && i.resolution !== "match")
const unconfirmed = (i: BackupItem) => i.state === "uncertain" && !i.resolution
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
/** Where an item stands. A checked channel counts as what the check found */
function stage(i: BackupItem): (typeof stages)[number] {
    if (i.resolution) return i.resolution === "match" ? "created" : i.resolution === "absent" ? "failed" : "conflict"
    return i.state === "created" || i.state === "updated" || i.state === "deleted"
        ? i.state
        : i.state === "skipped"
          ? "identical"
          : i.state === "conflict" || i.state === "blocked" || i.state === "failed"
            ? i.state
            : i.state === "uncertain"
              ? "not confirmed"
              : "still to do"
}
/** Where items stand in one line, such as 12 created, 1 failed, 20 still to do */
function progress(items: readonly BackupItem[]) {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(stage(item), (counts.get(stage(item)) ?? 0) + 1)
    return (
        stages
            .filter((name) => counts.get(name))
            .map((name) => (name === "conflict" ? plural(counts.get(name)!, name) : `${counts.get(name)} ${name}`))
            .join(", ") || "No items"
    )
}
const RESTORE_ITEMS_PAGE = 10
/** The items in the order a page lists them, problems first, then deletions, each group in plan order */
const byProblem = (items: readonly BackupItem[]) =>
    [...items].sort(
        (a, b) =>
            Number(problem(b)) - Number(problem(a)) ||
            Number(b.disposition === "delete") - Number(a.disposition === "delete") ||
            a.itemNo - b.itemNo,
    )
/**
 * A restore plan in two lines: Its decisions or progress, then whether it waits, runs or expired. The note names at most two next steps.
 * items are read only for a confirmed plan, since an unconfirmed plan's counts say everything
 */
function planCard(plan: BackupPlan, items: readonly BackupItem[] | undefined, now: number, config: BotConfig): Card {
    const command = (text: string) => code(serverCommands(text, config)),
        open = !plan.forgotten && now < plan.expiresAt,
        confirmed = plan.confirmedAt !== undefined
    const state = plan.forgotten
        ? "Forgotten"
        : !open
          ? `Expired ${ago(plan.expiresAt)}`
          : `${confirmed ? `Confirmed ${ago(plan.confirmedAt!)}` : "Waiting for your confirmation"}. Expires ${at(plan.expiresAt)}`
    const waiting = !confirmed || items?.some((i) => stage(i) === "still to do")
    const steps = [
        ...(!waiting
            ? []
            : open
              ? [`Send ${command("!backup confirm")} to ${confirmed ? "continue" : "start"}`]
              : plan.forgotten
                ? []
                : [`Attach the archive to ${command("!backup preview")} again to make a new plan`]),
        ...(items?.some(unconfirmed)
            ? [`${command("!backup reconcile")} checks the channels that were not confirmed`]
            : []),
        ...(!confirmed
            ? [`${command("!backup items")} lists each item, problems first`]
            : items?.some(problem)
              ? [`${command("!backup items")} lists problems first`]
              : []),
    ]
    return {
        title: "Restore plan",
        description: [
            confirmed && items ? progress(items) : decisions(plan.counts),
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
function previewCard(plan: BackupPlan, items: readonly BackupItem[], start: number, config: BotConfig) {
    const shown = byProblem(items).slice(start, start + RESTORE_ITEMS_PAGE),
        next = start + RESTORE_ITEMS_PAGE < items.length ? start + RESTORE_ITEMS_PAGE : undefined
    const card: Card = {
        title: "Restore preview",
        description: [
            `Checked ${ago(plan.createdAt)}, ${plan.confirmedAt === undefined ? "nothing changed yet" : `confirmed ${ago(plan.confirmedAt)}`}. ${decisions(plan.counts)}`,
            ...grants(plan.gain),
            ...deletions(plan.counts),
            ...effects(items),
            ...shown.map(itemLine),
        ].join("\n"),
        fields: next === undefined ? [] : [["Next", code(serverCommands("!backup preview next", config))]],
        ...(plan.confirmedAt === undefined
            ? {
                  note: `To restore, send ${code(serverCommands("!backup confirm", config))} before ${at(plan.expiresAt)}. A restore checks every item again`,
              }
            : {}),
    }
    return { card, next }
}
/** One page of a plan's items, problems first, and where the next page starts */
function itemsCard(items: readonly BackupItem[], start: number, config: BotConfig) {
    const sorted = byProblem(items),
        shown = sorted.slice(start, start + RESTORE_ITEMS_PAGE)
    const next = start + RESTORE_ITEMS_PAGE < sorted.length ? start + RESTORE_ITEMS_PAGE : undefined
    const card: Card = {
        title: "Restore items",
        description: shown.map(itemLine).join("\n") || "This plan has no items",
        fields: next === undefined ? [] : [["Next", code(serverCommands("!backup items next", config))]],
        ...(shown.some(unconfirmed)
            ? {
                  note: `${code(serverCommands("!backup reconcile", config))} checks the channels that were not confirmed`,
              }
            : {}),
        ...(sorted.some(problem) ? { footer: "Items that need attention come first" } : {}),
    }
    return { card, next }
}
/** What one confirmation did, in two lines, with at most two next steps */
function progressCard(
    pass: { results: readonly { item: BackupItem; recorded: boolean }[]; remaining: number },
    config: BotConfig,
): Card {
    const command = (text: string) => code(serverCommands(text, config)),
        recorded = pass.results.filter((r) => r.recorded).map((r) => r.item),
        unrecorded = pass.results.length - recorded.length
    const done = [
        ...(recorded.length ? [progress(recorded)] : []),
        ...(unrecorded ? [`${unrecorded} not recorded yet`] : []),
    ].join(", ")
    const steps = [
        ...(pass.remaining > 0 ? [`Send ${command("!backup confirm")} again to continue`] : []),
        ...(unrecorded || recorded.some(unconfirmed)
            ? [
                  `${command("!backup reconcile")} checks the channels that were not confirmed, a few minutes after they were tried`,
              ]
            : []),
        ...(recorded.some(problem) ? [`${command("!backup items")} lists problems first`] : []),
    ]
    return {
        title: "Restore progress",
        description: [
            done ? `This run: ${done}` : "Nothing was left to do in this run",
            pass.remaining > 0 ? `${pass.remaining} still to do` : "Every item is done",
        ].join("\n"),
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
        const card = (value: Card) => deliver(renderEmbeds(value))
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
                const snapshot = categories.length
                    ? yield* store.snapshot({ serverId: config.serverId, context: fresh, selected: categories })
                    : undefined
                const captured = command.selected.includes("structure")
                    ? yield* captureBackupStructure(client, config.serverId, message.author.id, message.channelId)
                    : undefined
                const native = captured && {
                    ...captured,
                    objects: yield* markManagedChannels(store, config, client, message, captured.objects),
                }
                const items =
                    (snapshot?.config.length ?? 0) + (snapshot?.xp.length ?? 0) + (native?.objects.length ?? 0)
                if (items > BACKUP_RESTORE_LIMITS.planItems) {
                    yield* send(
                        `This backup has ${items} items, more than one restore plan accepts (${BACKUP_RESTORE_LIMITS.planItems}). Export fewer categories at a time`,
                    )
                    return
                }
                const capturedAt = yield* Clock.currentTimeMillis
                const draft = {
                    version: 1,
                    backupId: randomUUID().replaceAll("-", ""),
                    provider,
                    serverId: config.serverId,
                    selected: command.selected,
                    capturedAt,
                    observations: {
                        databaseAt: snapshot?.capturedAt ?? null,
                        structureStartedAt: native?.startedAt ?? null,
                        structureFinishedAt: native?.finishedAt ?? null,
                    },
                    counts: {
                        config: snapshot?.config.length ?? 0,
                        xp: snapshot?.xp.length ?? 0,
                        structure: native?.objects.length ?? 0,
                        overwrites: native?.objects.reduce((n, c) => n + c.overwrites.length, 0) ?? 0,
                    },
                    exclusions: [...backupExclusions],
                    config: snapshot?.config ?? [],
                    xp: snapshot?.xp ?? [],
                    structure: native?.objects ?? [],
                }
                if (Buffer.byteLength(canonicalBackupJson(draft), "utf8") > BACKUP_RESTORE_LIMITS.planBytes) {
                    yield* send(
                        `This backup is larger than the ${BACKUP_RESTORE_LIMITS.planBytes / 1024} KiB one restore plan accepts. Export fewer categories at a time`,
                    )
                    return
                }
                const manifest = yield* Effect.try({
                    try: () => validateBackupManifest(draft),
                    catch: () => new BackupHandlingError({ reason: "capacity" }),
                })
                const bytes = yield* Effect.try({
                    try: () => encryptBackupManifest(manifest, config.backupKey!),
                    catch: () => new BackupHandlingError({ reason: "snapshot" }),
                })
                yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
                yield* uploadBackupAttachment(client, message.channelId, bytes, label)
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
            // A plan that a newer preview replaced is deleted, so the backend no longer finds it
            const readPlan = (binding: BackupBinding) =>
                store.query({ serverId: config.serverId, context: fresh, operation: { type: "plan", binding } }).pipe(
                    Effect.map((found) => (found.type === "plan" ? found.plan : undefined)),
                    Effect.catch((error) =>
                        error instanceof BackupStoreError && error.status === 404
                            ? Effect.succeed(undefined)
                            : Effect.fail(error),
                    ),
                )
            if (command.type === "preview") {
                // A preview is a plan, so the first page of it and each next page read the plan the owner can confirm
                const key = pageKey(config.serverId, message, "backup", "preview")
                const shown = (plan: BackupPlan, items: readonly BackupItem[], start: number) =>
                    Effect.gen(function* () {
                        const page = previewCard(plan, items, start, config)
                        yield* card(page.card)
                        rememberPosition(
                            key,
                            page.next === undefined ? undefined : { planId: plan.planId, start: page.next },
                        )
                        rememberPosition(planKey, backupBinding(plan))
                    })
                if (command.match && !message.attachments.length) {
                    yield* send(
                        serverCommands(
                            "Match needs the archive. Attach the encrypted .nfb archive to !backup preview match",
                            config,
                        ),
                    )
                    return
                }
                if (command.next || !message.attachments.length) {
                    const binding = nextPosition<BackupBinding>(planKey),
                        start = command.next
                            ? nextPosition<{ planId: string; start: number }>(key)
                            : { planId: binding?.planId, start: 0 }
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
                    yield* shown(
                        plan,
                        yield* readPlanItems(store, config, client, plan, message.channelId),
                        start.start,
                    )
                    return
                }
                if (!config.backupKey) {
                    yield* send(keyMissing)
                    return
                }
                const made = yield* makeBackupPlan(store, config, client, message, !!command.match).pipe(
                    Effect.map((plan) => ({ plan })),
                    // A file with the wrong name, size or type has its own reply
                    Effect.catch((error) =>
                        error instanceof BackupAttachmentError && error.reason === "metadata"
                            ? Effect.fail(error)
                            : Effect.succeed({
                                  failure:
                                      command.match && error instanceof BackupStoreError && error.status === 413
                                          ? matchTooBig
                                          : error instanceof BackupStoreError && error.status === 429
                                            ? planCapacity
                                            : previewFailureText[previewFailure(error)],
                              }),
                    ),
                )
                if ("failure" in made) {
                    yield* send(made.failure)
                    return
                }
                yield* shown(made.plan, yield* readPlanItems(store, config, client, made.plan, message.channelId), 0)
                return
            }
            if (command.type === "inspect") {
                if (message.attachments.length !== 1) {
                    yield* send(serverCommands("Attach one encrypted .nfb archive to !backup inspect", config))
                    return
                }
                const bytes = yield* downloadBackupAttachment(client, { serverId: config.serverId, message })
                const manifest = yield* readArchive(config, bytes, provider)
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
            const showPlan = (plan: BackupPlan, items?: readonly BackupItem[]) =>
                Effect.gen(function* () {
                    yield* card(planCard(plan, items, yield* Clock.currentTimeMillis, config))
                    rememberPosition(planKey, backupBinding(plan))
                })
            if (command.type === "status") {
                // The owner's newest plan that is not forgotten. A server holds at most 10 plans, so the first page has them all
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
                yield* showPlan(
                    latest,
                    latest.confirmedAt !== undefined
                        ? yield* readPlanItems(store, config, client, latest, message.channelId)
                        : undefined,
                )
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
                    ? nextPosition<{ planId: string; start: number }>(key)
                    : { planId: binding.planId, start: 0 }
                if (start?.planId !== binding.planId) {
                    yield* send(serverCommands(noNextPage("!backup items"), config))
                    return
                }
                const page = itemsCard(
                    yield* readPlanItems(store, config, client, found, message.channelId),
                    start.start,
                    config,
                )
                yield* card(page.card)
                rememberPosition(
                    key,
                    page.next === undefined ? undefined : { planId: binding.planId, start: page.next },
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
            if (
                command.type === "confirm" &&
                (found.forgotten || (yield* Clock.currentTimeMillis) >= found.expiresAt)
            ) {
                yield* send(
                    serverCommands(
                        `This restore plan ${found.forgotten ? "was forgotten" : `expired ${ago(found.expiresAt)}`}. Attach the archive to !backup preview again to make a new one`,
                        config,
                    ),
                )
                return
            }
            fresh = yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
            const result = yield* store.manage({
                serverId: config.serverId,
                messageId: message.id,
                createdAt: yield* sourceTimestamp(message),
                context: fresh,
                operation: { type: command.type, binding },
            })
            if (command.type === "forget") {
                rememberPosition(planKey, undefined)
                yield* send(
                    "Restore plan forgotten. Created channels stay, and NeonFlux still knows which archive channels they came from",
                )
                return
            }
            if (result.type !== "confirmed") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            const pass = yield* processBackupPlanPass(store, config, client, result.plan, message.channelId)
            yield* card(progressCard(pass, config))
        })
        yield* run.pipe(
            Effect.catch((error) =>
                error instanceof BackupAttachmentError && error.reason === "metadata"
                    ? send(`NeonFlux cannot use the attached file. Check its name, size and type. ${attachmentName}`)
                    : error instanceof BackupPermissionError && error.reason === "limit"
                      ? send(
                            `This server has more than the ${BACKUP_CATEGORY_LIMITS.structure} channels or ${BACKUP_RESTORE_LIMITS.overwrites} permission overwrites an archive holds. Export config or XP only`,
                        )
                      : error instanceof BackupStoreError && error.operation === "snapshot" && error.status === 413
                        ? send(
                              `This server has more settings or XP than an archive holds. An archive holds at most ${BACKUP_CATEGORY_LIMITS.config} settings items, counting each draft, template, response, automod rule and role panel, and XP for at most ${BACKUP_CATEGORY_LIMITS.xp} members`,
                          )
                        : error instanceof BackupHandlingError && error.reason === "archive"
                          ? send(
                                "NeonFlux cannot read that file as a backup. Send an archive that NeonFlux made, with the current backup key",
                            )
                          : send(
                                serverCommands(
                                    "The backup command was refused or could not be checked. Make sure you still own the server, this is a one-to-one DM, and the archive is within limits and made with the current backup key. " +
                                        "Run !backup status to see where a restore stands. A channel whose creation was not confirmed is never created again",
                                    config,
                                ),
                            ),
            ),
        )
    })
}
