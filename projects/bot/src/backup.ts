import { serverCommands, serverReply } from "./server-scope.ts"
import type * as C from "@neonflux/backend/contracts"
import { ChannelFlags, ChannelOperationError, ChannelType, MessageOperationError, type BotEventContext, type Client, type ChannelCreate, type Message } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect, Exit, Semaphore } from "effect"
import { createHash, randomUUID } from "node:crypto"
import type { BotConfig } from "./config.ts"
import { encryptBackupManifest, decryptBackupEnvelope } from "./backup-crypto.ts"
import { backupHelp, type BackupCommand } from "./backup-command.ts"
import { BackupAttachmentError, downloadBackupAttachment, uploadBackupAttachment } from "./backup-attachments.ts"
import { BackupPermissionError, captureBackupStructure, readBackupContext, readBackupNativeProof, snapshotBackupChannel } from "./backup-permissions.ts"
import { BackupStoreError, backupBinding, backupItemBinding, backupRestoreItemLimit, canonicalBackupJson, validateBackupManifest, type BackupStore } from "./backup-store.ts"
import { sourceTimestamp, noMentions } from "./responses.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"

export class BackupHandlingError extends Data.TaggedError("BackupHandlingError")<{ readonly reason: "binding" | "expired" | "disabled" | "grant" | "snapshot" | "claim" | "capacity" }> {}
const locks = new WeakMap<Client, Map<string, Semaphore.Semaphore>>()
const serial = (client: Client, serverId: string) => {
    let servers = locks.get(client)
    if (!servers) { servers = new Map(); locks.set(client, servers) }
    let lock = servers.get(serverId)
    if (!lock) { lock = Semaphore.makeUnsafe(1); servers.set(serverId, lock) }
    return lock
}
const providerFor = (client: Client) => client.instance.resolve({ timeoutMs: 5000 }).pipe(Effect.map(v => new URL(v.endpoints.apiPublic).origin))
const semantic = (v: C.BackupStructureObject) => { const { sourceId: _id, capturedAt: _at, ...fields } = v; return { ...fields, overwrites: [...v.overwrites].sort((a, b) => a.id.localeCompare(b.id)) } }
const sameChannel = (a: C.BackupStructureObject, b: C.BackupStructureObject) => canonicalBackupJson(semantic(a)) === canonicalBackupJson(semantic(b))
export function nativeBackupCreate(channel: C.BackupStructureObject): ChannelCreate {
    if (channel.type === "forum" || channel.type === "media") {
        // One request creates the channel with its tags, since REQUIRE_TAG needs them to exist
        const forum = { name: channel.name, parentId: channel.parentId, permissionOverwrites: channel.overwrites.map(o => ({ ...o, allow: BigInt(o.allow), deny: BigInt(o.deny) })),
            ...(channel.topic !== undefined ? { topic: channel.topic } : {}), ...(channel.nsfw !== undefined ? { nsfw: channel.nsfw } : {}), ...(channel.slowmodeSeconds !== undefined ? { rateLimitPerUser: channel.slowmodeSeconds } : {}),
            ...(channel.tags !== undefined ? { availableTags: channel.tags } : {}), ...(channel.defaultReaction !== undefined ? { defaultReactionEmoji: channel.defaultReaction } : {}),
            ...(channel.defaultAutoArchiveMinutes !== undefined ? { defaultAutoArchiveMinutes: channel.defaultAutoArchiveMinutes } : {}), ...(channel.sortOrder !== undefined ? { defaultSortOrder: channel.sortOrder } : {}),
            ...(channel.requireTag ? { flags: ChannelFlags.RequireTag } : {}) }
        return channel.type === "forum" ? { ...forum, type: ChannelType.Forum, ...(channel.layout !== undefined ? { defaultForumLayout: channel.layout } : {}) } : { ...forum, type: ChannelType.Media }
    }
    return { type: channel.type === "category" ? ChannelType.Category : channel.type === "text" ? ChannelType.Text : ChannelType.Voice, name: channel.name, parentId: channel.parentId,
        permissionOverwrites: channel.overwrites.map(o => ({ ...o, allow: BigInt(o.allow), deny: BigInt(o.deny) })),
        ...(channel.topic !== undefined ? { topic: channel.topic } : {}), ...(channel.nsfw !== undefined ? { nsfw: channel.nsfw } : {}), ...(channel.slowmodeSeconds !== undefined ? { rateLimitPerUser: channel.slowmodeSeconds } : {}), ...(channel.bitrate !== undefined ? { bitrate: channel.bitrate } : {}), ...(channel.userLimit !== undefined ? { userLimit: channel.userLimit } : {}) }
}
function readPlanItems(store: BackupStore, config: BotConfig, client: Client, plan: C.BackupPlan, dm: string) {
    return Effect.gen(function* () {
        let cursor: string | undefined
        const items: C.BackupItem[] = [], cursors = new Set<string>()
        for (let page = 0; page < 25; page++) {
            const context = yield* readBackupContext(client, config.serverId, plan.ownerId, dm)
            const result = yield* store.query({ serverId: config.serverId, context, operation: { type: "items", binding: backupBinding(plan), ...(cursor ? { cursor } : {}) } })
            if (result.type !== "items") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            items.push(...result.items)
            if (!result.nextCursor) {
                if (items.length !== plan.itemCount || new Set(items.map(i => i.itemNo)).size !== items.length) return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                return items.sort((a, b) => a.itemNo - b.itemNo)
            }
            if (cursors.has(result.nextCursor)) return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            cursors.add(result.nextCursor); cursor = result.nextCursor
        }
        return yield* Effect.fail(new BackupHandlingError({ reason: "capacity" }))
    })
}
function readOriginMappings(store: BackupStore, config: BotConfig, client: Client, ownerId: string, dm: string, provider: string) {
    return Effect.gen(function* () {
        const mappings = new Map<string, string>(), cursors = new Set<string>()
        let cursor: string | undefined
        for (let page = 0; page < 250; page++) {
            const context = yield* readBackupContext(client, config.serverId, ownerId, dm)
            const result = yield* store.query({ serverId: config.serverId, context, operation: { type: "origins", provider, ...(cursor ? { cursor } : {}) } })
            if (result.type !== "origins") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            for (const origin of result.origins) if (origin.category === "structure" && origin.mappedId) mappings.set(origin.sourceId, origin.mappedId)
            if (!result.nextCursor) return mappings
            if (cursors.has(result.nextCursor)) return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            cursors.add(result.nextCursor); cursor = result.nextCursor
        }
        return yield* Effect.fail(new BackupHandlingError({ reason: "capacity" }))
    })
}
function safeNativeProof(proof: C.BackupNativeProof, desired: C.BackupStructureObject, serverId: string) {
    if (!proof.actorCanManageChannels || !proof.botCanManageChannels) return false
    if (desired.parentId && !proof.references.some(r => r.id === desired.parentId && r.type === "category" && r.exists && r.actorCanAccess && r.botCanAccess && r.actorCanManage && r.botCanManage)) return false
    return desired.overwrites.every(o => proof.references.some(r => r.id === o.id && r.type === o.type && r.exists && r.actorCanAccess && r.botCanAccess && (o.type !== "role" || o.id === serverId || r.actorCanManage && r.botCanManage)))
}
function checkPlan(store: BackupStore, config: BotConfig, client: Client, plan: C.BackupPlan, dm: string, work: boolean) {
    return Effect.gen(function* () {
        if (plan.serverId !== config.serverId || plan.provider !== (yield* providerFor(client))) return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
        const context = yield* readBackupContext(client, config.serverId, plan.ownerId, dm)
        const result = yield* store.query({ serverId: config.serverId, context, operation: { type: "plan", binding: backupBinding(plan) } })
        if (result.type !== "plan" || result.plan.ownerId !== plan.ownerId || result.plan.forgotten) return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
        if (work && (result.plan.confirmedAt === undefined || (yield* Clock.currentTimeMillis) >= result.plan.expiresAt)) return yield* Effect.fail(new BackupHandlingError({ reason: "expired" }))
        return result.plan
    })
}
/** One exact reservation/claim/create. Unknown transport never triggers discovery or replay */
export function executeBackupStructureItem(store: BackupStore, config: BotConfig, client: Client, plan: C.BackupPlan, item: C.BackupItem, object: C.BackupStructureObject, dm: string, mappings: ReadonlyMap<string, string>) {
    return Effect.suspend(() => {
        const binding = backupItemBinding(item), claimToken = randomUUID().replaceAll("-", "")
        let ownsClaim = false, invoked = false, nativeStage = false, mappedId: string | null = null, channel: C.BackupStructureObject | null = null
        const work = Effect.gen(function* () {
            yield* checkPlan(store, config, client, plan, dm, true)
            let native = yield* readBackupNativeProof(client, config.serverId, plan.ownerId, dm, [object], mappings)
            let context = yield* readBackupContext(client, config.serverId, plan.ownerId, dm)
            const reservation = yield* store.work({ serverId: config.serverId, operation: { type: "reserve", binding, context, native } })
            if (reservation.type === "item") return reservation.item
            const grant = reservation.grant
            const desired = { ...object, parentId: object.parentId ? mappings.get(object.parentId) ?? object.parentId : null }
            if (grant.nativeDeadlineMs !== 5000 || grant.provider !== plan.provider || grant.serverId !== config.serverId || grant.ownerId !== plan.ownerId || grant.botId !== context.botId || grant.sourceId !== object.sourceId || !sameChannel(grant.channel, desired) || grant.dispatchExpiresAt > plan.expiresAt) return yield* Effect.fail(new BackupHandlingError({ reason: "grant" }))
            native = yield* readBackupNativeProof(client, config.serverId, plan.ownerId, dm, [object], mappings)
            context = yield* readBackupContext(client, config.serverId, plan.ownerId, dm)
            const claimed = yield* store.work({ serverId: config.serverId, operation: { type: "claim", binding, claimToken, context, native } })
            if (claimed.type !== "grant" || !claimed.claimed || canonicalBackupJson(claimed.grant) !== canonicalBackupJson(grant)) return yield* Effect.fail(new BackupHandlingError({ reason: "claim" }))
            ownsClaim = true
            const finalProof = yield* readBackupNativeProof(client, config.serverId, plan.ownerId, dm, [object], mappings)
            if (!safeNativeProof(finalProof, grant.channel, config.serverId) || finalProof.ownerId !== grant.ownerId || finalProof.botId !== grant.botId || !finalProof.observations.some(o => o.sourceId === object.sourceId && o.status === "absent")) return yield* Effect.fail(new BackupHandlingError({ reason: "grant" }))
            yield* readBackupContext(client, config.serverId, plan.ownerId, dm)
            // Nothing awaited between the final grant deadline check and invoking the SDK create
            const dispatchAt = yield* Clock.currentTimeMillis
            if (dispatchAt >= grant.dispatchExpiresAt) return yield* Effect.fail(new BackupHandlingError({ reason: "expired" }))
            invoked = true; nativeStage = true
            const created = yield* client.channels.create(config.serverId, nativeBackupCreate(grant.channel), { timeoutMs: Math.min(5000, grant.dispatchExpiresAt - dispatchAt) })
            nativeStage = false
            if (created.guildId !== config.serverId || !/^[1-9]\d{0,18}$/.test(created.id)) return yield* Effect.fail(new BackupHandlingError({ reason: "snapshot" }))
            mappedId = created.id
            const createdAt = yield* Clock.currentTimeMillis
            channel = yield* Effect.try({ try: () => snapshotBackupChannel(created, createdAt), catch: () => new BackupHandlingError({ reason: "snapshot" }) })
            if (!sameChannel(channel, grant.channel)) return yield* Effect.fail(new BackupHandlingError({ reason: "snapshot" }))
            const fresh = yield* client.channels.fetch(mappedId, { timeoutMs: 5000 })
            if (fresh.id !== mappedId || fresh.guildId !== config.serverId) return yield* Effect.fail(new BackupHandlingError({ reason: "snapshot" }))
            const observedAt = yield* Clock.currentTimeMillis
            channel = yield* Effect.try({ try: () => snapshotBackupChannel(fresh, observedAt), catch: () => new BackupHandlingError({ reason: "snapshot" }) })
            if (!sameChannel(channel, grant.channel)) return yield* Effect.fail(new BackupHandlingError({ reason: "snapshot" }))
            return undefined
        })
        const finish = Effect.gen(function* () {
            const result = yield* Effect.exit(work)
            if (!ownsClaim) return { item: Exit.isSuccess(result) && result.value ? result.value : item, recorded: Exit.isSuccess(result), outcome: "blocked" as const }
            const notDispatched = Exit.isFailure(result) && nativeStage && result.cause.reasons.length > 0 && result.cause.reasons.every(r => r._tag === "Fail" && r.error instanceof ChannelOperationError && r.error.outcome === "notDispatched")
            const noDispatch = Exit.isFailure(result) && (!invoked || notDispatched)
            const outcome = Exit.isSuccess(result) ? "created" as const : noDispatch ? "failed" as const : "uncertain" as const
            const ack = yield* store.work({ serverId: config.serverId, operation: { type: "outcome", binding, claimToken, outcome, ...(noDispatch ? { noDispatch: true as const } : {}), channel, mappedId } }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            return { item: ack?.item ?? item, recorded: !!ack, outcome }
        })
        return finish.pipe(Effect.onInterrupt(() => ownsClaim ? store.work({ serverId: config.serverId, operation: { type: "outcome", binding, claimToken, outcome: invoked ? "uncertain" : "failed", ...(!invoked ? { noDispatch: true as const } : {}), channel, mappedId } }).pipe(Effect.interruptible, Effect.timeout("5 seconds"), Effect.catchCause(() => Effect.void), Effect.asVoid) : Effect.void))
    })
}
export function processBackupPlanPass(store: BackupStore, config: BotConfig, client: Client, plan: C.BackupPlan, privateChannelId: string) {
    return serial(client, config.serverId).withPermit(Effect.gen(function* () {
        plan = yield* checkPlan(store, config, client, plan, privateChannelId, true)
        const items = yield* readPlanItems(store, config, client, plan, privateChannelId)
        const mappings = yield* readOriginMappings(store, config, client, plan.ownerId, privateChannelId, plan.provider)
        for (const i of items) if (i.category === "structure" && i.mappedId) mappings.set(i.sourceId, i.mappedId)
        const results: { item: C.BackupItem, recorded: boolean, outcome: string }[] = []
        for (const item of items) {
            if (results.length >= 20) break
            if (!["planned", "reserved"].includes(item.state)) continue
            yield* checkPlan(store, config, client, plan, privateChannelId, true)
            let context = yield* readBackupContext(client, config.serverId, plan.ownerId, privateChannelId)
            const value = yield* store.query({ serverId: config.serverId, context, operation: { type: "item", binding: backupItemBinding(item) } })
            if (value.type !== "item" || !value.object) return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            let result: { item: C.BackupItem, recorded: boolean, outcome: string }
            if (item.category === "structure" && item.disposition === "create" && "type" in value.object) result = yield* executeBackupStructureItem(store, config, client, plan, item, value.object, privateChannelId, mappings)
            else {
                const native = "family" in value.object || "type" in value.object ? yield* readBackupNativeProof(client, config.serverId, plan.ownerId, privateChannelId, [value.object], mappings) : null
                context = yield* readBackupContext(client, config.serverId, plan.ownerId, privateChannelId)
                const applied = yield* store.work({ serverId: config.serverId, operation: { type: "apply", binding: backupItemBinding(item), context, native } })
                result = { item: applied.item, recorded: true, outcome: applied.item.state }
            }
            results.push(result)
            if (result.item.mappedId) mappings.set(item.sourceId, result.item.mappedId)
        }
        return { results, remaining: items.filter(i => ["planned", "reserved"].includes(i.state)).length - results.filter(r => r.recorded).length }
    }))
}
export function reconcileBackupPlan(store: BackupStore, config: BotConfig, client: Client, plan: C.BackupPlan, privateChannelId: string) {
    return serial(client, config.serverId).withPermit(Effect.gen(function* () {
        plan = yield* checkPlan(store, config, client, plan, privateChannelId, false)
        const items = yield* readPlanItems(store, config, client, plan, privateChannelId), results: C.BackupItem[] = []
        const mappings = yield* readOriginMappings(store, config, client, plan.ownerId, privateChannelId, plan.provider)
        for (const i of items) if (i.category === "structure" && i.mappedId) mappings.set(i.sourceId, i.mappedId)
        for (const item of items) {
            if (results.length >= 20) break
            if (item.category !== "structure" || !item.mappedId || item.resolution === "match" || !["claimed", "uncertain", "failed"].includes(item.state)) continue
            let context = yield* readBackupContext(client, config.serverId, plan.ownerId, privateChannelId)
            const found = yield* store.query({ serverId: config.serverId, context, operation: { type: "item", binding: backupItemBinding(item) } })
            if (found.type !== "item" || !found.object || !("type" in found.object)) continue
            const native = yield* readBackupNativeProof(client, config.serverId, plan.ownerId, privateChannelId, [found.object], mappings)
            context = yield* readBackupContext(client, config.serverId, plan.ownerId, privateChannelId)
            const result = yield* store.work({ serverId: config.serverId, operation: { type: "reconcile", binding: backupItemBinding(item), context, native } })
            results.push(result.item)
        }
        return results
    }))
}
const keyMissing = "Backup crypto is disabled. Configure an independent NEONFLUX_BACKUP_KEY bot-side and keep a protected offline copy. Never send keys in chat"
function readArchive(config: BotConfig, bytes: Uint8Array, provider: string) {
    return Effect.gen(function* () {
        const manifest = yield* Effect.try({ try: () => validateBackupManifest(decryptBackupEnvelope(bytes, config.backupKey!)), catch: () => new BackupHandlingError({ reason: "snapshot" }) })
        if (manifest.provider !== provider || manifest.serverId !== config.serverId) return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
        return manifest
    })
}
/** The archive attached to an owner's DM message, and fresh native evidence of the server for every item a restore plan decides */
function readRestoreEvidence(store: BackupStore, config: BotConfig, client: Client, message: Message) {
    return Effect.gen(function* () {
        const provider = yield* providerFor(client), bytes = yield* downloadBackupAttachment(client, { serverId: config.serverId, message })
        const manifest = yield* readArchive(config, bytes, provider)
        const mappings = manifest.structure.length || manifest.config.length ? yield* readOriginMappings(store, config, client, message.author.id, message.channelId, provider) : new Map<string, string>()
        const native = manifest.config.length || manifest.structure.length ? yield* readBackupNativeProof(client, config.serverId, message.author.id, message.channelId, [...manifest.config, ...manifest.structure], mappings) : null
        const context = yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
        return { manifest, archiveDigest: createHash("sha256").update(bytes).digest("hex"), native, context }
    })
}
/** What a restore plan made now would do with each archive item. The backend runs the plan's own decisions and stores only this preview */
export function previewBackupArchive(store: BackupStore, config: BotConfig, client: Client, message: Message, page: number) {
    return Effect.gen(function* () {
        const { manifest, archiveDigest, native, context } = yield* readRestoreEvidence(store, config, client, message)
        return yield* store.preview({ serverId: config.serverId, context, manifest, archiveDigest, native, archive: { channelId: message.channelId, messageId: message.id }, page })
    })
}
const previewTarget = (i: C.BackupPreviewItem) => i.category === "structure" ? `channel ${i.name} (${i.sourceId})` : i.category === "xp" ? `XP of ${i.sourceId}` : `${i.family} ${i.sourceId}`
const previewOutcome = (i: C.BackupPreviewItem) => i.disposition === "create" ? "would be created" : i.disposition === "skip" ? "skipped, identical"
    : `${i.disposition === "conflict" ? "skipped, conflicts" : "blocked"}: ${i.reason}`
/** One page of a restore preview, with the command for the next page */
export function describeBackupPreview(preview: C.BackupPreviewPage, config: BotConfig) {
    const { counts } = preview
    return [`Restore preview of archive ${preview.backupId}, checked ${new Date(preview.checkedAt).toISOString()}. Nothing was changed`,
        `Would create ${counts.create}, skip as identical ${counts.skip}, skip as conflicting ${counts.conflict}, blocked ${counts.blocked}`,
        ...preview.items.map(i => `${i.itemNo}: ${previewTarget(i)}: ${previewOutcome(i)}`),
        serverCommands(`Page ${preview.page} of ${preview.pages}${preview.page < preview.pages ? ". Send !backup preview next for the next page" : ""}`, config),
        serverCommands("A restore checks every item again when it runs. Send !backup plan with the same archive attached to start one", config)].join("\n")
}
/** The website's preview refresh: Reads the stored archive message and the server again as the bot, never with the owner's sign-in */
export function processBackupPreviewPass(store: BackupStore, config: BotConfig, client: Client) {
    return Effect.gen(function* () {
        const { job } = yield* store.previewReady(config.serverId)
        if (!job) return
        if (!config.backupKey) { yield* store.previewFailed(config.serverId, "key"); return }
        // The owner and private DM check comes first, so a sender who no longer owns the server is told apart from an unreadable archive
        const failure = yield* readBackupContext(client, config.serverId, job.ownerId, job.channelId).pipe(
            Effect.andThen(client.messages.fetch({ channelId: job.channelId, id: job.messageId }, { timeoutMs: 5000 })),
            Effect.flatMap(message => message.author.id === job.ownerId ? previewBackupArchive(store, config, client, message, 1) : Effect.fail(new BackupHandlingError({ reason: "binding" }))),
            Effect.as(undefined),
            Effect.catch(error => Effect.succeed(previewFailure(error))))
        if (failure) yield* store.previewFailed(config.serverId, failure)
    })
}
function previewFailure(error: unknown): Exclude<C.BackupPreviewFailure, "unanswered"> {
    if (error instanceof BackupPermissionError) return error.reason === "owner" || error.reason === "private" ? "owner" : error.reason === "permissions" ? "refused" : "error"
    if (error instanceof BackupAttachmentError) return error.reason === "transport" ? "error" : "archive"
    if (error instanceof BackupStoreError) return error.status === 413 ? "refused" : "error"
    if (error instanceof BackupHandlingError || error instanceof MessageOperationError && error.reason === "notFound") return "archive"
    return "error"
}
const previewFailureText: Record<Exclude<C.BackupPreviewFailure, "unanswered">, string> = {
    owner: "Only the current server Owner can preview a restore, in a one-to-one DM with NeonFlux",
    archive: "The archive could not be read. Attach the .nfb file again, and check that it belongs to this server and was made with the current recovery key",
    key: keyMissing,
    refused: "A restore refuses this archive as a whole. It may exceed restore limits, or a channel permission overwrite may grant permissions that you or NeonFlux lack. Export again, or give NeonFlux those permissions first",
    error: "The preview could not be made right now. Try again shortly",
}
const describePlan = (plan: C.BackupPlan) => [`Plan ${plan.planId}, revision ${plan.revision}, expires ${new Date(plan.expiresAt).toISOString()}`, `Creates ${plan.counts.create}, identical skips ${plan.counts.skip}, conflicts ${plan.counts.conflict}, blocked ${plan.counts.blocked}. Automatic restored configuration stays disabled`, `Plan hash ${plan.planHash}`, `Archive digest ${plan.archiveDigest}`, `!backup confirm ${plan.planId} ${plan.planHash} ${plan.archiveDigest}`].join("\n")
const describeItem = (i: C.BackupItem) => `${i.itemNo}: ${i.category}/${i.family} ${i.sourceId}, ${i.state}, ${i.disposition}${i.reason ? `, ${i.reason}` : ""}${i.mappedId ? `, exact mapping ${i.mappedId}` : ""}${i.disabledOnCreate ? ", disabled on create" : ""}`
export function handleBackupCommand(store: BackupStore | undefined, config: BotConfig, command: BackupCommand, context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const { message, client } = context
        if (message.guildId !== undefined) {
            if (message.guildId === config.serverId) yield* context.reply({ content: `Use !backup${config.scope?.mode === "multi" ? ` --server ${config.serverId}` : ""} help in a one-to-one DM with NeonFlux. Backup and restore require the current server Owner`, allowedMentions: noMentions })
            return
        }
        if (message.author.isBot || message.author.isSystem || message.webhookId) return
        let fresh = yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
        const send = (content: string) => Effect.gen(function* () {
            if (config.scope?.mode === "multi") content = serverReply(content, config.serverId)
            if (content.length > 64000) return yield* Effect.fail(new BackupHandlingError({ reason: "capacity" }))
            for (let offset = 0; offset < content.length; offset += 1900) {
                yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
                yield* client.messages.send(message.channelId, { content: content.slice(offset, offset + 1900), allowedMentions: noMentions }, { timeoutMs: 5000 })
            }
        })
        if ("error" in command || command.type === "help") { yield* send("error" in command ? command.error : serverCommands(backupHelp, config)); return }
        if (!config.backupKey && ["export", "inspect", "plan"].includes(command.type)) { yield* send(keyMissing); return }
        if (!store) { yield* send("Backup persistence is not configured. Configure the existing Convex bot service before exporting or restoring"); return }
        const run = Effect.gen(function* () {
            const provider = yield* providerFor(client)
            if (command.type === "export") {
                const caps = yield* store.query({ serverId: config.serverId, context: fresh, operation: { type: "capabilities" } })
                if (caps.type !== "capabilities") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                const categories = command.selected.filter((c): c is "config" | "xp" => c !== "structure")
                const snapshot = categories.length ? yield* store.snapshot({ serverId: config.serverId, context: fresh, selected: categories }) : undefined
                const native = command.selected.includes("structure") ? yield* captureBackupStructure(client, config.serverId, message.author.id, message.channelId) : undefined
                const items = (snapshot?.config.length ?? 0) + (snapshot?.xp.length ?? 0) + (native?.objects.length ?? 0)
                if (items > backupRestoreItemLimit) { yield* send(`This backup has ${items} items, more than one restore plan accepts (${backupRestoreItemLimit}). Export fewer categories at a time`); return }
                const capturedAt = yield* Clock.currentTimeMillis
                const manifest = yield* Effect.try({ try: () => validateBackupManifest({ version: 1, backupId: randomUUID().replaceAll("-", ""), provider, serverId: config.serverId, selected: command.selected, capturedAt,
                    observations: { databaseAt: snapshot?.capturedAt ?? null, structureStartedAt: native?.startedAt ?? null, structureFinishedAt: native?.finishedAt ?? null }, counts: { config: snapshot?.config.length ?? 0, xp: snapshot?.xp.length ?? 0, structure: native?.objects.length ?? 0, overwrites: native?.objects.reduce((n, c) => n + c.overwrites.length, 0) ?? 0 }, exclusions: caps.capabilities.exclusions, config: snapshot?.config ?? [], xp: snapshot?.xp ?? [], structure: native?.objects ?? [] }), catch: () => new BackupHandlingError({ reason: "capacity" }) })
                const bytes = yield* Effect.try({ try: () => encryptBackupManifest(manifest, config.backupKey!), catch: () => new BackupHandlingError({ reason: "snapshot" }) })
                yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
                yield* uploadBackupAttachment(client, message.channelId, bytes)
                return
            }
            if (command.type === "preview") {
                // Each shown page remembers where the next starts, and next pages the latest preview even with an archive attached
                const key = pageKey(config.serverId, message, "backup", "preview")
                const shown = (preview: C.BackupPreviewPage) => { rememberPosition(key, preview.page < preview.pages ? preview.page + 1 : undefined); return describeBackupPreview(preview, config) }
                if (command.next || !message.attachments.length) {
                    const page = command.next ? nextPosition<number>(key) : 1
                    if (page === undefined) { yield* send(serverCommands(noNextPage("!backup preview"), config)); return }
                    const stored = yield* store.query({ serverId: config.serverId, context: fresh, operation: { type: "preview", page } })
                    if (stored.type !== "preview") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                    yield* send(stored.preview ? shown(stored.preview) : serverCommands("No restore preview yet. Attach an encrypted .nfb archive to !backup preview", config)); return
                }
                if (!config.backupKey) { yield* send(keyMissing); return }
                const preview = yield* previewBackupArchive(store, config, client, message, 1).pipe(Effect.map(shown),
                    Effect.catch(error => Effect.succeed(previewFailureText[previewFailure(error)])))
                yield* send(preview); return
            }
            if (command.type === "inspect") {
                const bytes = yield* downloadBackupAttachment(client, { serverId: config.serverId, message })
                const manifest = yield* readArchive(config, bytes, provider)
                yield* send(`Archive ${manifest.backupId}, version 1, categories ${manifest.selected.join(", ")}\nConfig ${manifest.counts.config}, XP ${manifest.counts.xp}, channels ${manifest.counts.structure}\nCapture ${new Date(manifest.capturedAt).toISOString()}. Database snapshot and separate native observations are not atomic\nExclusions: ${manifest.exclusions.join(", ")}`); return
            }
            if (command.type === "plan") {
                const { manifest, archiveDigest, native, context: evidence } = yield* readRestoreEvidence(store, config, client, message)
                const result = yield* store.manage({ serverId: config.serverId, messageId: message.id, createdAt: yield* sourceTimestamp(message), context: evidence, operation: { type: "plan", manifest, archiveDigest, native } })
                if (result.type !== "plan") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                const items = yield* readPlanItems(store, config, client, result.plan, message.channelId)
                yield* send([describePlan(result.plan), ...items.map(describeItem), "Conflicting and blocked objects stay untouched. Nothing is overwritten, deleted, moved or automatically activated"].join("\n")); return
            }
            if (command.type === "status" && !command.binding) {
                const result = yield* store.query({ serverId: config.serverId, context: fresh, operation: { type: "plans" } })
                if (result.type === "plans") yield* send(result.plans.map(describePlan).join("\n\n") || "No retained restore plans")
                return
            }
            if (!("binding" in command) || !command.binding) return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            const found = yield* store.query({ serverId: config.serverId, context: fresh, operation: { type: "plan", binding: command.binding } })
            if (found.type !== "plan" || found.plan.ownerId !== message.author.id || found.plan.provider !== provider) return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            if (command.type === "status") { const items = found.plan.forgotten ? [] : yield* readPlanItems(store, config, client, found.plan, message.channelId); yield* send([describePlan(found.plan), ...items.map(describeItem)].join("\n")); return }
            if (command.type === "reconcile") { const items = yield* reconcileBackupPlan(store, config, client, found.plan, message.channelId); yield* send(items.map(describeItem).join("\n") || "No known-ID recovery items. Unknown creates remain blocked without adoption or replay"); return }
            fresh = yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
            const result = yield* store.manage({ serverId: config.serverId, messageId: message.id, createdAt: yield* sourceTimestamp(message), context: fresh, operation: { type: command.type, binding: command.binding } })
            if (command.type === "forget") { yield* send(`Settled plan details forgotten for ${result.plan.planId}. Native objects and durable origin mappings remain`); return }
            if (result.type !== "confirmed") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            const pass = yield* processBackupPlanPass(store, config, client, result.plan, message.channelId)
            yield* send([`Pass processed ${pass.results.length}, remaining ${pass.remaining}`, ...pass.results.map(r => `${describeItem(r.item)}, acknowledged ${r.recorded}`), "Read status before continuing. Partial progress is retained without destructive rollback"].join("\n"))
        })
        yield* run.pipe(Effect.catch(() => send("Backup operation refused or could not be verified. Check current Owner/DM access, recovery key configuration, archive limits and restore status. Unknown native creates are never replayed")))
    })
}
