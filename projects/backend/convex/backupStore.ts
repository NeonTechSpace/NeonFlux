import { BACKUP_RESTORE_LIMITS, backupGain } from "@neonflux/contracts/backup"
import { permissionNames } from "@neonflux/contracts/permission-names"
import type {
    BackupBinding,
    BackupConfigObject,
    BackupContext,
    BackupItem,
    BackupItemBinding,
    BackupLiveChannel,
    BackupNativeProof,
    BackupOrigin,
    BackupPlan,
    BackupStructureObject,
} from "@neonflux/contracts/backup"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc, Id } from "./_generated/dataModel.js"
import { BACKUP_RETENTION, backupChannelSemantic, backupHash, canonicalBackupJson } from "./backupDomain.ts"
import { memberRecoveries } from "./moderationStore.ts"
import { fail, object } from "./validation.ts"

export type BackupRead = MutationCtx | QueryCtx
// Whether a plan keeps an item whose outcome is still open: reserved, claimed, a channel creation that is uncertain without a resolution, or that failed
// without a resolution after it may have been sent. An update or delete that is uncertain or failed keeps nothing, since a new check compares the
// server itself. by_plan_unresolved reads at most one item of each kind
export async function backupPlanUnresolved(ctx: BackupRead, planId: Id<"backupPlans">) {
    const items = () => ctx.db.query("backupItems")
    return Boolean(
        (await items()
            .withIndex("by_plan_unresolved", (q) => q.eq("planId", planId).eq("state", "reserved"))
            .first()) ??
        (await items()
            .withIndex("by_plan_unresolved", (q) => q.eq("planId", planId).eq("state", "claimed"))
            .first()) ??
        (await items()
            .withIndex("by_plan_unresolved", (q) =>
                q.eq("planId", planId).eq("state", "uncertain").eq("resolution", undefined),
            )
            .filter((q) => q.eq(q.field("disposition"), "create"))
            .first()) ??
        (await items()
            .withIndex("by_plan_unresolved", (q) =>
                q.eq("planId", planId).eq("state", "failed").eq("resolution", undefined).eq("noDispatch", undefined),
            )
            .filter((q) => q.eq(q.field("disposition"), "create"))
            .first()),
    )
}
export async function backupSetRetention(ctx: MutationCtx, plan: Doc<"backupPlans">) {
    const unresolved = await backupPlanUnresolved(ctx, plan._id)
    await ctx.db.patch(plan._id, {
        cleanupAt: unresolved ? undefined : Math.max(plan.expiresAt, Date.now()) + BACKUP_RETENTION,
    })
}
export async function backupPlanRow(ctx: BackupRead, serverId: string, binding: BackupBinding) {
    const id = ctx.db.normalizeId("backupPlans", binding.planId),
        row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== serverId) fail(404, "Restore plan not found")
    if (
        row.planHash !== binding.planHash ||
        row.archiveDigest !== binding.archiveDigest ||
        row.revision !== binding.revision
    )
        fail(409, "Restore plan binding changed")
    return row
}
export async function backupItemRow(ctx: BackupRead, serverId: string, binding: BackupItemBinding) {
    const plan = await backupPlanRow(ctx, serverId, binding),
        item = await ctx.db
            .query("backupItems")
            .withIndex("by_number", (q) =>
                q.eq("serverId", serverId).eq("planId", plan._id).eq("itemNo", binding.itemNo),
            )
            .unique()
    if (!item || item.generation !== binding.generation) fail(404, "Restore item not found")
    return { plan, item }
}
export function publicBackupPlan(row: Doc<"backupPlans">): BackupPlan {
    const {
        serverId,
        ownerId,
        provider,
        backupId,
        archiveDigest,
        manifestDigest,
        planHash,
        revision,
        createdAt,
        expiresAt,
        itemCount,
        counts,
        gain,
        match,
        forgotten,
    } = row
    return {
        planId: row._id,
        serverId,
        ownerId,
        provider,
        backupId,
        archiveDigest,
        manifestDigest,
        planHash,
        revision,
        createdAt,
        expiresAt,
        itemCount,
        counts,
        gain,
        match,
        forgotten,
        ...(row.confirmedAt !== undefined ? { confirmedAt: row.confirmedAt } : {}),
    }
}
export function publicBackupItem(plan: Doc<"backupPlans">, item: Doc<"backupItems">): BackupItem {
    const {
        category,
        family,
        sourceId,
        itemNo,
        generation,
        disposition,
        reason,
        state,
        expectedHash,
        desiredHash,
        dependencyItemNo,
        mappedId,
    } = item
    return {
        planId: plan._id,
        revision: 1,
        planHash: plan.planHash,
        archiveDigest: plan.archiveDigest,
        category,
        family: family as BackupItem["family"],
        sourceId,
        itemNo,
        generation,
        disposition,
        reason,
        state,
        expectedHash,
        desiredHash,
        dependencyItemNo,
        mappedId,
        ...(item.name !== undefined ? { name: item.name } : {}),
        ...(item.extra ? { extra: true as const } : {}),
        ...(item.changed ? { changed: item.changed } : {}),
        ...(item.gain ? { gain: true as const } : {}),
        ...(item.on ? { on: true as const } : {}),
        ...(item.warning ? { warning: item.warning } : {}),
        ...(item.dispatchExpiresAt !== undefined ? { dispatchExpiresAt: item.dispatchExpiresAt } : {}),
        ...(item.claimedAt !== undefined ? { claimedAt: item.claimedAt } : {}),
        ...(item.finishedAt !== undefined ? { finishedAt: item.finishedAt } : {}),
        ...(item.noDispatch ? { noDispatch: true } : {}),
        ...(item.historicalOutcome ? { historicalOutcome: item.historicalOutcome } : {}),
        ...(item.resolution ? { resolution: item.resolution } : {}),
    }
}
export function publicBackupOrigin(row: Doc<"backupOrigins">): BackupOrigin {
    const {
        provider,
        serverId,
        category,
        family,
        sourceId,
        state,
        planId,
        itemNo,
        generation,
        mappedId,
        desiredHash,
        resolved,
    } = row
    return {
        provider,
        serverId,
        category,
        family: family as BackupOrigin["family"],
        sourceId,
        state,
        planId,
        itemNo,
        generation,
        mappedId,
        desiredHash,
        ...(resolved ? { resolved } : {}),
    }
}
/** Whether DEFCON 1 pauses restore execution */
async function backupPaused(ctx: BackupRead, serverId: string) {
    const config = await ctx.db
        .query("moderationSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    return config?.config.defcon === 1
}
export async function backupOwner(ctx: BackupRead, serverId: string, context: BackupContext, critical = true) {
    if (!critical && (await backupPaused(ctx, serverId))) fail(403, "DEFCON pauses restore execution")
    for (const userId of [context.ownerId, context.botId]) {
        const recoveries = await memberRecoveries(ctx, serverId, userId)
        if (recoveries.count > 10) fail(403, "Backup participant restricted")
        if (recoveries.cases.some((c) => c?.action === "quarantine")) fail(403, "Backup participant quarantined")
    }
}
export function backupPlanOwner(plan: Doc<"backupPlans">, context: BackupContext, execute = false) {
    if (plan.ownerId !== context.ownerId || plan.provider !== context.provider)
        fail(403, "Restore requires the same actual Owner and provider")
    if (execute && (plan.forgotten || plan.confirmedAt === undefined || Date.now() >= plan.expiresAt))
        fail(409, "Confirmed unexpired restore plan required")
}
/** Where an archive channel went: the channel a restore created for it */
export const backupOriginRow = (ctx: BackupRead, serverId: string, provider: string, sourceId: string) =>
    ctx.db
        .query("backupOrigins")
        .withIndex("by_origin", (q) =>
            q
                .eq("serverId", serverId)
                .eq("provider", provider)
                .eq("category", "structure")
                .eq("family", "structure")
                .eq("sourceId", sourceId),
        )
        .unique()
const backupReusableOrigin = (origin: Doc<"backupOrigins"> | null) =>
    origin?.state === "failed" && origin.noDispatch === true && origin.mappedId === null
// Counts one origin about to be inserted against the origin mapping limit per server and provider. Origins stay until the server's purge, so the
// count only grows
export async function backupOriginCapacity(ctx: MutationCtx, serverId: string, provider: string) {
    const row = await ctx.db
        .query("backupOriginCounts")
        .withIndex("by_provider", (q) => q.eq("serverId", serverId).eq("provider", provider))
        .unique()
    const count = row?.count ?? 0
    if (count >= BACKUP_RESTORE_LIMITS.originMappings) fail(429, "Restore origin mapping capacity reached")
    if (row) await ctx.db.patch(row._id, { count: count + 1 })
    else await ctx.db.insert("backupOriginCounts", { serverId, provider, count: count + 1 })
}
const ADMINISTRATOR = 8n,
    MANAGE_CHANNELS = 16n,
    MANAGE_ROLES = 1n << 28n
const noPermissions = { allow: "0", deny: "0" }
const overwriteJson = (rows: BackupStructureObject["overwrites"]) =>
    canonicalBackupJson([...rows].sort((a, b) => a.id.localeCompare(b.id)))
// At most four titles, so a reason stays short whatever is missing
const permissionList = (bits: bigint) => {
    const names = permissionNames(bits.toString())
    return names.slice(0, 4).join(", ") + (names.length > 4 ? ` and ${names.length - 4} more` : "")
}
const grantIt = (bits: bigint) => (permissionNames(bits.toString()).length > 1 ? "them" : "it")
/** At most three names, each cut to 40 characters, so a reason stays short */
const backupNameList = (names: readonly string[]) =>
    names
        .slice(0, 3)
        .map((name) => (name.length > 40 ? `${name.slice(0, 39)}…` : name))
        .join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "")
/** NeonFlux lacks these permissions, which `where` says the place of, such as " in <#5>" */
const lacks = (missing: bigint, where: string) =>
    `NeonFlux needs ${permissionList(missing)}${where}. Grant ${grantIt(missing)} to the NeonFlux role, then check again`
const unstorable = "Fluxer cannot store this channel's permission mask"
const managedReasons = {
    ticket: "A ticket channel belongs to its ticket, so a restore leaves it alone",
    voiceRoom: "A temporary voice room ends with its call, so a restore leaves it alone",
}
/** Whether a ticket or a temporary voice room has this channel, which a restore never creates, changes or deletes. NeonFlux forgets them later */
export async function backupProtected(ctx: BackupRead, serverId: string, ids: readonly string[]) {
    for (const channelId of new Set(ids)) {
        if (
            await ctx.db
                .query("tickets")
                .withIndex("by_channel", (q) => q.eq("serverId", serverId).eq("channelId", channelId))
                .first()
        )
            return "ticket" as const
        if (
            await ctx.db
                .query("voiceRooms")
                .withIndex("by_channel", (q) => q.eq("serverId", serverId).eq("channelId", channelId))
                .first()
        )
            return "voiceRoom" as const
    }
    return null
}
const protectedSkip = (kind: "ticket" | "voiceRoom") => ({
    disposition: "skip" as const,
    reason: managedReasons[kind],
    mappedId: null,
})
/**
 * The channel as a restore can write it: without the overwrites of a role or member that is gone. Those come back as dropped, except that an
 * overwrite the server's channel already holds stays as it is and is no change when it equals the archive's. Every comparison, grant check and
 * read-back of a channel uses this one value
 */
function backupEffectiveChannel(
    channel: BackupStructureObject,
    proof: BackupNativeProof,
    observed?: BackupStructureObject | null,
) {
    const gone = (o: BackupStructureObject["overwrites"][number]) =>
        proof.references.some((r) => r.id === o.id && r.type === o.type && !r.exists)
    const held = (o: BackupStructureObject["overwrites"][number]) => observed?.overwrites.find((x) => x.id === o.id)
    return {
        channel: {
            ...channel,
            overwrites: channel.overwrites.flatMap((o) => (!gone(o) ? [o] : held(o) ? [held(o)!] : [])),
        },
        dropped: channel.overwrites.filter(
            (o) => gone(o) && canonicalBackupJson(held(o) ?? null) !== canonicalBackupJson(o),
        ),
    }
}
/** Whether an overwrite holds a bit above the 63 Fluxer stores, so it can be archived but not written */
const unstorableMask = (channel: BackupStructureObject) =>
    channel.overwrites.some((o) => (BigInt(o.allow) | BigInt(o.deny)) >> 63n)
/** Why NeonFlux cannot create this channel, from Fluxer's create rule: Manage channels, Manage roles, which a create always sends overwrites for, and no allow beyond NeonFlux's own */
function backupCreateRefusal(channel: BackupStructureObject, proof: BackupNativeProof): string | null {
    const parent =
        channel.parentId === null
            ? undefined
            : proof.references.find((x) => x.id === channel.parentId && x.type === "category")
    if (channel.parentId !== null && !(parent?.exists && parent.botCanAccess && parent.botCanManage))
        return `Its category <#${channel.parentId}> is gone, or NeonFlux cannot manage it`
    const server = BigInt(proof.botPermissions),
        need = MANAGE_CHANNELS | MANAGE_ROLES
    if (server & ADMINISTRATOR) return unstorableMask(channel) ? unstorable : null
    if (need & ~server) return lacks(need & ~server, "")
    if (unstorableMask(channel)) return unstorable
    const inside = parent ? BigInt(parent.permissions) : server
    const beyond = channel.overwrites.reduce((bits, o) => bits | (BigInt(o.allow) & ~inside), 0n)
    return beyond
        ? `NeonFlux cannot allow ${permissionList(beyond)} in this channel's permissions, because it does not have ${grantIt(beyond)} itself${parent ? ` in <#${channel.parentId}>` : ""}. Grant ${grantIt(beyond)} to the NeonFlux role, then check again`
        : null
}
/**
 * Why NeonFlux cannot bring this existing channel to the desired one, from Fluxer's edit rule: Manage channels, and for a changed overwrite
 * list Manage roles and no gain beyond what NeonFlux has in this channel, over every old and new target. channelBits are NeonFlux's own
 * permissions in the channel
 */
function backupUpdateRefusal(
    observed: BackupStructureObject,
    desired: BackupStructureObject,
    channelBits: string,
    proof: BackupNativeProof,
    pendingParent: boolean,
): string | null {
    const bits = BigInt(channelBits),
        where = ` in <#${observed.sourceId}>`,
        changed = overwriteJson(observed.overwrites) !== overwriteJson(desired.overwrites),
        need = MANAGE_CHANNELS | (changed ? MANAGE_ROLES : 0n)
    if (!(bits & ADMINISTRATOR) && need & ~bits) return lacks(need & ~bits, where)
    if (changed) {
        if (unstorableMask(desired)) return unstorable
        const before = new Map(observed.overwrites.map((o) => [o.id, o])),
            after = new Map(desired.overwrites.map((o) => [o.id, o]))
        let beyond = 0n
        for (const id of new Set([...before.keys(), ...after.keys()]))
            beyond |= backupGain(before.get(id) ?? noPermissions, after.get(id) ?? noPermissions) & ~bits
        if (!(bits & ADMINISTRATOR) && beyond)
            return `Its permissions would give ${permissionList(beyond)}, which NeonFlux does not have${where}. Grant ${grantIt(beyond)} to the NeonFlux role there, then check again`
    }
    if (desired.parentId !== null && desired.parentId !== observed.parentId && !pendingParent) {
        const parent = proof.references.find((x) => x.id === desired.parentId && x.type === "category")
        if (!parent?.exists || !parent.botCanManage)
            return `Its category <#${desired.parentId}> is gone, or NeonFlux cannot manage it`
    }
    return null
}
async function backupMappedChannel(
    ctx: BackupRead,
    plan: Pick<Doc<"backupPlans">, "serverId" | "provider">,
    channel: BackupStructureObject,
) {
    if (channel.parentId === null) return channel
    const map = await backupOriginRow(ctx, plan.serverId, plan.provider, channel.parentId)
    if (map) {
        if (map.state !== "created" || !map.mappedId || map.resolved === "absent" || map.resolved === "conflict")
            return null
        return { ...channel, parentId: map.mappedId }
    }
    return channel
}
export async function backupRewriteConfig(
    value: unknown,
    mapped: (id: string) => Promise<string>,
): Promise<BackupConfigObject> {
    const item = structuredClone(value) as BackupConfigObject
    const channelKeys = new Set(["channelId", "parentId", "logChannelId"]),
        arrays = new Set([
            "channelIds",
            "exemptChannelIds",
            "excludedChannelIds",
            "honeypotChannelIds",
            "messageChannelIds",
        ])
    async function walk(value: unknown): Promise<void> {
        if (Array.isArray(value)) {
            for (const x of value) if (x && typeof x === "object") await walk(x)
            return
        }
        if (!value || typeof value !== "object") return
        const row = object(value)
        for (const [key, val] of Object.entries(row)) {
            if (channelKeys.has(key) && typeof val === "string") row[key] = await mapped(val)
            else if (arrays.has(key) && Array.isArray(val)) {
                const ids: string[] = []
                for (const id of val as string[]) ids.push(await mapped(id))
                row[key] = ids
            } else if (val && typeof val === "object") await walk(val)
        }
    }
    await walk(item.value)
    return item.family === "cleanupPolicy" ? { ...item, sourceId: item.value.channelId } : item
}
/**
 * A setting with each archive channel it names mapped to the channel an earlier restore made for it, or null while such a channel is not
 * confirmed. pending are the channels the plan creates, which keep their archive ID until the plan's own create maps them
 */
export async function backupMappedConfig(
    ctx: BackupRead,
    plan: Pick<Doc<"backupPlans">, "serverId" | "provider">,
    value: unknown,
    pending: ReadonlyMap<string, unknown> = new Map(),
) {
    let blocked = false
    const item = await backupRewriteConfig(value, async (id) => {
        const origin = await backupOriginRow(ctx, plan.serverId, plan.provider, id)
        if (!origin || pending.has(id)) return id
        if (
            origin.state !== "created" ||
            !origin.mappedId ||
            origin.resolved === "absent" ||
            origin.resolved === "conflict"
        ) {
            blocked = true
            return id
        }
        return origin.mappedId
    })
    return blocked ? null : item
}
export async function backupConfigMappingsCurrent(
    ctx: BackupRead,
    plan: Doc<"backupPlans">,
    mappings: NonNullable<Doc<"backupItems">["configMappings"]>,
) {
    for (const mapping of mappings) {
        const origin = await backupOriginRow(ctx, plan.serverId, plan.provider, mapping.sourceId)
        if (mapping.targetId === null) {
            if (
                !origin ||
                origin.state !== "created" ||
                !origin.mappedId ||
                origin.planId !== plan._id ||
                origin.itemNo !== mapping.targetItemNo ||
                origin.resolved === "absent" ||
                origin.resolved === "conflict"
            )
                return false
        } else if (
            origin
                ? origin.state !== "created" ||
                  origin.mappedId !== mapping.targetId ||
                  origin.resolved === "absent" ||
                  origin.resolved === "conflict"
                : mapping.targetId !== mapping.sourceId
        )
            return false
    }
    return true
}
/** What the decisions about one archive's channels share: the categories the plan creates, the archive's channels by the ID they have on the server now, and the match mode */
type BackupStructureView = {
    pending: Set<string>
    live: ReadonlyMap<string, BackupStructureObject>
    match: boolean
}
export async function backupStructureView(
    ctx: BackupRead,
    plan: Pick<Doc<"backupPlans">, "serverId" | "provider">,
    archive: readonly BackupStructureObject[],
    match: boolean,
): Promise<BackupStructureView> {
    const live = new Map<string, BackupStructureObject>()
    for (const object of archive)
        live.set(
            (await backupOriginRow(ctx, plan.serverId, plan.provider, object.sourceId))?.mappedId ?? object.sourceId,
            object,
        )
    return { pending: new Set(), live, match }
}
/** Why a role or member left out of a channel's permissions, such as "<@&5> and 2 more" */
const droppedNote = (dropped: BackupStructureObject["overwrites"]) =>
    `Its permissions for ${backupNameList(dropped.map((o) => (o.type === "role" ? `<@&${o.id}>` : `<@${o.id}>`)))} are not restored, since the role or member is gone`
type BackupStructureDecision = {
    disposition: "create" | "update" | "skip" | "blocked"
    reason: string | null
    mappedId: string | null
    expectedHash: string
    desiredHash?: string
    /** The channel as it is now and as it should be, with its category as it is on the server, for an update */
    observed?: BackupStructureObject
    desired?: BackupStructureObject
    dropped?: BackupStructureObject["overwrites"]
    /** Channels of a type a restore does not archive that a category's permission change also reaches, and the archived channels it reaches */
    follows?: string[]
    cascaded?: string[]
}
/**
 * What to do with a category's channels that follow it. Fluxer copies a category's permission change to every channel whose permissions equal the
 * category's, and offers no way to skip it. So the change is allowed only when each of those channels ends with the category's new permissions
 * anyway: an archived channel that the archive gives the same permissions, or a channel of a type a restore does not archive, which NeonFlux's
 * dashboard link follows on purpose. Every other channel would be changed by Fluxer on the side, so the change is blocked
 */
async function backupCascade(
    ctx: BackupRead,
    serverId: string,
    proof: BackupNativeProof,
    view: BackupStructureView,
    category: BackupStructureObject,
    liveId: string,
) {
    const kept: string[] = [],
        first: string[] = [],
        away: string[] = [],
        follows: string[] = [],
        cascaded: string[] = [],
        synced = proof.channels.filter((c) => c.parentId === liveId && c.synced)
    for (const c of synced) {
        const archived = view.live.get(c.id)
        if (archived) {
            const owned = archived.managed || (await backupProtected(ctx, serverId, [archived.sourceId, c.id]))
            if (!owned && overwriteJson(archived.overwrites) === overwriteJson(category.overwrites)) cascaded.push(c.id)
            // The plan moves it out itself, after the category, so there is nothing to do by hand
            else if (!owned && archived.parentId !== category.sourceId) away.push(c.name)
            else kept.push(c.name)
        } else if (!backupRestorableTypes.includes(c.type)) follows.push(c.name)
        else if (view.match && c.botCanManage && !(await backupProtected(ctx, serverId, [c.id]))) first.push(c.name)
        else kept.push(c.name)
    }
    // The manual move-out comes first, and the others show on the next check, so the reason stays within the limit of an item's reason
    const reason = kept.length
        ? `Fluxer would also copy these permissions to ${backupNameList(kept)}. Move them out of the category in Fluxer, check again and restore, then move them back (moving does not sync them)`
        : [
              ...(first.length ? [`This run deletes ${backupNameList(first)} first. Check again after it`] : []),
              ...(away.length ? [`This run moves ${backupNameList(away)} out first. Check again after it`] : []),
          ].join(". ")
    return { reason: reason || null, follows, cascaded, synced: synced.map((c) => c.id).sort() }
}
/** The types of channel an archive holds, which a restore may create, change and delete */
export const backupRestorableTypes: readonly string[] = ["category", "text", "voice", "announcement"]
/**
 * What a restore does with one archive channel on the server as the fresh native evidence shows it: Create what is missing, update what differs
 * and skip what is the same, or block it with the reason and the fix. A channel that tickets or voice rooms own is skipped. A role or member
 * that is gone is left out of the permissions, and its overwrite comes back as dropped
 */
export async function backupNativeDecision(
    ctx: BackupRead,
    plan: Pick<Doc<"backupPlans">, "serverId" | "provider">,
    channel: BackupStructureObject,
    proof: BackupNativeProof | null,
    view: BackupStructureView,
    // The item being reserved or claimed, whose own reservation of the origin is not an earlier restore
    item?: Pick<Doc<"backupItems">, "planId" | "itemNo">,
): Promise<BackupStructureDecision> {
    const prior = await backupOriginRow(ctx, plan.serverId, plan.provider, channel.sourceId),
        origin = backupReusableOrigin(prior) ? null : prior,
        own = prior?.state === "reserved" && prior.planId === item?.planId && prior.itemNo === item.itemNo,
        mappedId = origin?.mappedId ?? channel.sourceId
    const decide = async (
        disposition: BackupStructureDecision["disposition"],
        reason: string | null,
        id: string | null,
        expected: unknown,
        more: Partial<BackupStructureDecision> = {},
    ) => ({ disposition, reason, mappedId: id, expectedHash: await backupHash(expected), ...more })
    if (channel.managed) return { ...protectedSkip(channel.managed), expectedHash: await backupHash(null) }
    if (
        origin &&
        !own &&
        (origin.state !== "created" || origin.resolved === "absent" || origin.resolved === "conflict")
    )
        return decide("blocked", "An earlier restore of this channel did not finish", origin.mappedId, origin)
    if (!proof) return decide("blocked", "NeonFlux could not read the server's channels", null, null)
    const observation = proof.observations.find((x) => x.sourceId === mappedId)
    if (!observation || observation.status === "unknown")
        return decide(
            "blocked",
            "NeonFlux could not tell whether this channel still exists",
            origin?.mappedId ?? null,
            null,
        )
    const owned = await backupProtected(ctx, plan.serverId, [channel.sourceId, mappedId])
    if (owned) return { ...protectedSkip(owned), expectedHash: await backupHash(null) }
    const observed = observation.channel,
        seen = observed && backupChannelSemantic(observed),
        { channel: effective, dropped } = backupEffectiveChannel(channel, proof, observed)
    // The archive's own form of the desired channel, which a claim compares again, since the category it names may not exist yet
    const desiredHash = await backupHash(backupChannelSemantic(backupEffectiveChannel(channel, proof).channel)),
        pendingParent = effective.parentId !== null && view.pending.has(effective.parentId)
    const desired =
        effective.parentId === null || pendingParent ? effective : await backupMappedChannel(ctx, plan, effective)
    const blocked = (reason: string) => decide("blocked", reason, observed ? mappedId : null, seen, { desiredHash })
    const unread = effective.overwrites.find((o) => !proof.references.some((r) => r.id === o.id && r.type === o.type))
    if (unread)
        return blocked(
            `NeonFlux could not read the ${unread.type} ${unread.type === "role" ? `<@&${unread.id}>` : `<@${unread.id}>`} in its permissions. Check again`,
        )
    if (!desired) return blocked("Its category from an earlier restore could not be confirmed")
    if (!observed) {
        const refusal = backupCreateRefusal(pendingParent ? { ...desired, parentId: null } : desired, proof)
        return refusal ? blocked(refusal) : decide("create", null, null, null, { desiredHash, desired, dropped })
    }
    if (observed.sourceId !== mappedId) fail(400, "Native observation identity mismatch")
    if (canonicalBackupJson(seen) === canonicalBackupJson(backupChannelSemantic(desired)))
        return decide("skip", dropped.length ? droppedNote(dropped) : null, mappedId, seen, {
            desiredHash,
            observed,
            desired,
            dropped,
        })
    // Fluxer converts a text channel to an announcement channel and back, and no other type to another
    const textLike = ["text", "announcement"]
    if (observed.type !== desired.type && !(textLike.includes(observed.type) && textLike.includes(desired.type)))
        return blocked("It is another kind of channel now, and Fluxer cannot change that")
    const refusal = backupUpdateRefusal(observed, desired, observation.botPermissions, proof, pendingParent)
    if (refusal) return blocked(refusal)
    const cascade =
        observed.type === "category" && overwriteJson(observed.overwrites) !== overwriteJson(desired.overwrites)
            ? await backupCascade(ctx, plan.serverId, proof, view, channel, mappedId)
            : undefined
    if (cascade?.reason)
        return decide("blocked", cascade.reason, mappedId, { channel: seen, synced: cascade.synced }, { desiredHash })
    return decide("update", null, mappedId, cascade ? { channel: seen, synced: cascade.synced } : seen, {
        desiredHash,
        observed,
        desired,
        dropped,
        ...(cascade ? { follows: cascade.follows, cascaded: cascade.cascaded } : {}),
    })
}
/**
 * What match mode does with a channel or category on the server that the archive does not hold: delete it, leave it when tickets or voice rooms own
 * it, or block it when NeonFlux cannot manage it or a category would still hold a channel. leaving are the channels that this plan deletes or moves
 * out of their category
 */
export async function backupExtraDecision(
    ctx: BackupRead,
    serverId: string,
    proof: BackupNativeProof,
    extra: BackupLiveChannel,
    leaving: ReadonlySet<string>,
) {
    const decide = async (
        disposition: "delete" | "blocked",
        reason: string | null,
    ): Promise<{ disposition: "delete" | "skip" | "blocked"; reason: string | null; expectedHash: string }> => ({
        disposition,
        reason,
        expectedHash: await backupHash({ id: extra.id, type: extra.type, name: extra.name, parentId: extra.parentId }),
    })
    // Like an archive channel that tickets or voice rooms own, so a skip is settled the same way
    const owned = await backupProtected(ctx, serverId, [extra.id])
    if (owned) return { ...protectedSkip(owned), expectedHash: await backupHash(null) }
    if (!extra.botCanManage) return decide("blocked", lacks(MANAGE_CHANNELS, ` in <#${extra.id}>`))
    const holds = proof.channels.filter((c) => c.parentId === extra.id && !leaving.has(c.id))
    return holds.length
        ? decide(
              "blocked",
              `The category would still hold ${backupNameList(holds.map((c) => c.name))}, so NeonFlux does not delete it. Move them out in Fluxer, then check again`,
          )
        : decide("delete", null)
}
export function backupGrant(plan: Doc<"backupPlans">, item: Doc<"backupItems">) {
    if (!item.desiredChannel || !item.botId || item.dispatchExpiresAt === undefined)
        fail(409, "Native item is not reserved")
    const action: "create" | "update" | "delete" =
        item.disposition === "update" || item.disposition === "delete" ? item.disposition : "create"
    if (action !== "create" && !item.fromChannel) fail(409, "Native item is not claimed")
    return {
        planId: plan._id,
        revision: 1 as const,
        planHash: plan.planHash,
        archiveDigest: plan.archiveDigest,
        itemNo: item.itemNo,
        generation: 1 as const,
        provider: plan.provider,
        serverId: plan.serverId,
        ownerId: plan.ownerId,
        botId: item.botId,
        sourceId: item.sourceId,
        action,
        channel: item.desiredChannel,
        ...(action !== "create" ? { from: item.fromChannel! } : {}),
        dispatchExpiresAt: item.dispatchExpiresAt,
        nativeDeadlineMs: 5000 as const,
    }
}
