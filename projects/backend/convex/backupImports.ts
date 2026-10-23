import type { BackupConfigObject, BackupNativeProof, BackupXpObject } from "@neonflux/contracts/backup"
import type { QueryCtx, MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { backupConfigIdentity, backupHash, canonicalBackupJson } from "./backupDomain.ts"
import { backupClearedRoute, backupConfigRows, projectBackupConfig } from "./backupProjections.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { currentXp, readLeveling, readProfile } from "./levelingStore.ts"
import { permissionNames } from "@neonflux/contracts/permission-names"
import { autoroleIds, safeRole } from "./rolesDomain.ts"
import { rolePolicy } from "./roleClaims.ts"
import { object } from "./validation.ts"

type Read = QueryCtx | MutationCtx
/** The rows of one configuration family, which a caller reads once with backupConfigRows */
type FamilyRows = Awaited<ReturnType<typeof backupConfigRows>>
async function backupCurrentConfig(
    ctx: Read,
    serverId: string,
    item: BackupConfigObject,
    rows: FamilyRows,
): Promise<{
    row: FamilyRows[number] | null
    value: BackupConfigObject | null
    hash: string
}> {
    const row = rows.find(
        (row) =>
            !backupClearedRoute(item.family, row) &&
            backupConfigIdentity(projectBackupConfig(item.family, row)) === item.sourceId,
    )
    if (!row) return { row: null, value: null, hash: await backupHash(null) }
    const value = projectBackupConfig(item.family, row),
        r = object(row),
        raw = "config" in r ? object(r.config) : r
    // Hash current authored state and domain revisions, excluding operational counters
    const revisions = Object.fromEntries(
        [
            "revision",
            "configRevision",
            "mappingRevision",
            "scoreEpoch",
            "intentRevision",
            "audienceGeneration",
            "configured",
            "published",
            "withdrawing",
        ]
            .filter((k) => raw[k] !== undefined)
            .map((k) => [k, raw[k]]),
    )
    // Turning the cleanup module on resumes the policies that are on, and each policy's revision moves with its age and exclusions, so the
    // warning the owner confirmed stays true only while those policies do
    const retained = item.family === "cleanup" ? await backupRetainedPolicies(ctx, serverId) : undefined
    return { row, value, hash: await backupHash({ id: r._id, value, revisions, ...(retained ? { retained } : {}) }) }
}
async function backupCurrentXp(
    ctx: Read,
    serverId: string,
    item: BackupXpObject,
): Promise<{ row: Doc<"levelingProfiles"> | null; xp: number; hash: string }> {
    const state = await readLeveling(ctx, serverId),
        policy = state?.config ?? defaultLevelingSettings(),
        row = await readProfile(ctx, serverId, item.userId)
    const xp = currentXp(policy, row)
    return {
        row,
        xp,
        hash: await backupHash({
            id: row?._id ?? null,
            xp: row ? xp : null,
            epoch: policy.scoreEpoch,
            adjustmentRevision: row?.adjustmentRevision ?? null,
            resetAt: row?.resetAt ?? null,
        }),
    }
}
async function backupConfigurationCapacity(
    ctx: Read,
    serverId: string,
    item: BackupConfigObject,
    planned: BackupConfigObject[],
    rows: FamilyRows,
): Promise<string | null> {
    const same = planned.filter((x) => x.family === item.family)
    if (item.family === "response" || item.family === "automod") {
        if (rows.length + same.length >= 100)
            return `The server has reached its limit of 100 ${{ response: "custom commands and autoresponders", automod: "automod rules" }[item.family]}`
    }
    if (
        item.family === "panel" &&
        rows.filter((x) => object(x).kind === item.value.kind).length +
            same.filter((x) => x.family === "panel" && x.value.kind === item.value.kind).length >=
            (item.value.kind === "reaction" ? 50 : 1)
    )
        return "The server has reached its limit of role panels of this kind"
    if (item.family === "ticketCategory" && rows.length + same.length >= 20)
        return "The server has reached its limit of 20 ticket categories"
    if (item.family === "cleanupPolicy") {
        const state = await ctx.db
            .query("cleanupSettings")
            .withIndex("by_server", (q) => q.eq("serverId", serverId))
            .unique()
        if (rows.length + same.length >= 50 || (state?.policies ?? 0) + same.length >= 50)
            return "The server has reached its limit of 50 cleanup channels"
    }
    return null
}
function backupConfigReferences(
    item: BackupConfigObject,
): { id: string; type: "role" | "member" | "category" | "text"; safeRole?: boolean; staff?: boolean }[] {
    const refs: ReturnType<typeof backupConfigReferences> = [],
        role = (id: string, safe = false, staff = false) =>
            refs.push({ id, type: "role", ...(safe ? { safeRole: true } : {}), ...(staff ? { staff: true } : {}) }),
        channel = (id: string | null | undefined, type: "category" | "text" = "text") => {
            if (id) refs.push({ id, type })
        },
        owner = (id: string | undefined) => {
            if (id) refs.push({ id, type: "member" })
        }
    switch (item.family) {
        case "moderation":
            Object.values(item.value.staffRoleIds)
                .flat()
                .forEach((id) => role(id, false, true))
            channel(item.value.logChannelId)
            item.value.honeypotChannelIds.forEach((id) => channel(id))
            break
        case "response":
            item.value.roleIds.forEach((id) => role(id))
            item.value.channelIds.forEach((id) => channel(id))
            break
        case "automod":
            item.value.exemptRoleIds.forEach((id) => role(id))
            ;[...item.value.channelIds, ...item.value.exemptChannelIds].forEach((id) => channel(id))
            break
        case "roles":
            autoroleIds(item.value).forEach((id) => role(id, true))
            break
        case "panel":
            item.value.mappings.forEach((m) => {
                role(m.roleId, true)
                ;[...m.prerequisiteRoleIds, ...m.exclusionRoleIds].forEach((id) => role(id))
            })
            break
        case "greetings":
            Object.values(item.value.routes).forEach((q) => channel(q.channelId))
            break
        case "ticketCategory":
            channel(item.value.parentId, "category")
            item.value.supportRoleIds.forEach((id) => role(id, false, true))
            break
        case "leveling":
            item.value.excludedRoleIds.forEach((id) => role(id))
            item.value.excludedChannelIds.forEach((id) => channel(id))
            item.value.mappings.forEach((m) => role(m.roleId, true))
            if (item.value.levelUp?.channelId) channel(item.value.levelUp.channelId)
            break
        case "milestoneRoute":
            channel(item.value.channelId)
            break
        case "suggestions":
            channel(item.value.channelId)
            break
        case "cleanupPolicy":
            channel(item.value.channelId)
            owner(item.value.ownerId)
            break
        case "metadata":
            ;[...item.value.routes, ...item.value.eventRoutes].forEach((q) => {
                channel(q.channelId)
                owner(q.ownerId)
            })
            ;[...item.value.messageChannelIds, ...item.value.excludedChannelIds].forEach((id) => channel(id))
            break
    }
    return refs
}
// A channel, category, role or member that a restored setting uses, as a mention for the preview and restore replies
const referenceName = ({ id, type }: { id: string; type: "role" | "member" | "category" | "text" }) =>
    type === "role"
        ? `role <@&${id}>`
        : type === "member"
          ? `member <@${id}>`
          : `${type === "text" ? "channel" : "category"} <#${id}>`
async function backupValidateConfigReferences(
    ctx: Read,
    serverId: string,
    item: BackupConfigObject,
    proof: BackupNativeProof | null,
    pendingChannels: Map<string, string> = new Map(),
): Promise<string | null> {
    const refs = backupConfigReferences(item)
    if (refs.length && !proof) return "NeonFlux could not check the channels, roles and members this uses"
    const roles =
            proof?.references
                .filter((x) => x.type === "role")
                .map((x) => ({
                    roleId: x.id,
                    permissions: x.permissions,
                    actorCanManage: x.actorCanManage,
                    botCanManage: x.botCanManage,
                })) ?? [],
        policy = await rolePolicy(ctx, serverId)
    for (const ref of refs) {
        if ((ref.type === "text" || ref.type === "category") && pendingChannels.get(ref.id) === ref.type) continue
        const evidence = proof?.references.find((x) => x.id === ref.id && x.type === ref.type)
        if (!evidence?.exists || !evidence.actorCanAccess || !evidence.botCanAccess)
            return `The ${referenceName(ref)} is gone, or you or NeonFlux cannot see it`
        // Only a role that members get is assigned, so only it must rank below. A staff role or one that filters or exempts is only read
        if (ref.safeRole) {
            if (!evidence.actorCanManage || !evidence.botCanManage)
                return `The role <@&${ref.id}> ranks at or above your highest role or NeonFlux's`
            try {
                safeRole(serverId, ref.id, roles, policy.staffRoleIds, true)
            } catch {
                return `Members cannot get the role <@&${ref.id}> on their own, because it is a staff role or grants more than basic permissions`
            }
        }
        if (ref.staff && ref.id === serverId) return "@everyone cannot be a staff role"
        if (
            ref.staff &&
            ((await ctx.db
                .query("roleReferences")
                .withIndex("by_server_role", (q) => q.eq("serverId", serverId).eq("roleId", ref.id))
                .first()) ||
                (await ctx.db
                    .query("roleOwnership")
                    .withIndex("by_server_role", (q) =>
                        q.eq("serverId", serverId).eq("roleId", ref.id).eq("protected", true),
                    )
                    .first()))
        )
            return `Another NeonFlux feature manages the role <@&${ref.id}>`
    }
    return null
}
/**
 * Why a restore may not write this setting even though its references hold, or null. A published panel belongs to its message, so it is
 * withdrawn first, and a panel keeps its kind and a rule its type
 */
function backupFamilyRefusal(
    item: BackupConfigObject,
    current: BackupConfigObject | null,
    row: Record<string, unknown> | null,
): string | null {
    if (item.family === "panel" && row) {
        if (row.published !== undefined || row.withdrawing === true)
            return "Withdraw this role panel first, then check again"
        if (current?.family === "panel" && current.value.kind !== item.value.kind)
            return "A panel with that name has a different kind"
    }
    if (item.family === "automod" && current?.family === "automod" && current.value.type !== item.value.type)
        return "An automod rule with that name has a different type"
    return null
}

type Retained = { channelId: string; ageMs: number; revision?: number }[]
/** The cleanup policies that are on now. A paused cleanup module leaves them on, so turning the module on resumes them */
async function backupRetainedPolicies(ctx: Read, serverId: string): Promise<Retained> {
    return (
        await ctx.db
            .query("cleanupPolicies")
            .withIndex("by_channel", (q) => q.eq("serverId", serverId))
            .take(51)
    )
        .filter((x) => x.enabled)
        .map((x) => ({ channelId: x.channelId, ageMs: x.ageMs, revision: x.revision }))
}
/**
 * What a restore starts to delete or post: the cleanup policies that turn on or delete more (a paused module resumes the policies that are on),
 * and the log routes that turn on, move, or go live because the logging module turns on
 */
function backupEscalation(item: BackupConfigObject, current: BackupConfigObject | null, retained: Retained = []) {
    const none = {
        cleanups: [] as Retained,
        routes: [] as ({ channelId?: string } & ({ category: string } | { eventType: string }))[],
    }
    if (item.family === "cleanupPolicy") {
        const was = current?.family === "cleanupPolicy" ? current.value : null
        return item.value.enabled && (!was?.enabled || item.value.ageMs < was.ageMs)
            ? { ...none, cleanups: [item.value] }
            : null
    }
    if (item.family === "cleanup")
        return item.value.enabled && !(current?.family === "cleanup" && current.value.enabled) && retained.length
            ? { ...none, cleanups: retained }
            : null
    if (item.family !== "metadata") return null
    const was = current?.family === "metadata" ? current.value : null,
        enabledNow = new Set(
            was?.enabled
                ? [...was.routes, ...was.eventRoutes]
                      .filter((route) => route.enabled)
                      .map((route) => canonicalBackupJson(route))
                : [],
        ),
        routes = [...item.value.routes, ...item.value.eventRoutes].filter(
            (route) => route.enabled && !enabledNow.has(canonicalBackupJson(route)),
        )
    return item.value.enabled && routes.length ? { ...none, routes } : null
}
const age = (ms: number) =>
    ms % 86400000 === 0
        ? `${ms / 86400000} day${ms === 86400000 ? "" : "s"}`
        : ms % 3600000 === 0
          ? `${ms / 3600000} hour${ms === 3600000 ? "" : "s"}`
          : `${Math.round(ms / 60000)} minutes`
/** Joins what fits in a line and counts the rest */
function fit(head: string, parts: string[]) {
    let text = `${head}${parts[0]}`
    for (const [i, part] of parts.slice(1).entries()) {
        const next = `${text}, ${part}`
        if (next.length > 220) return `${text} and ${parts.length - 1 - i} more`
        text = next
    }
    return text
}
/**
 * What an item that deletes or posts says it does, for the preview and the chat card to show the owner next to its confirmation: a cleanup
 * policy that turns on, and the log destinations that turn on or move
 */
function backupWarning(
    item: BackupConfigObject,
    current: BackupConfigObject | null,
    retained: Retained = [],
): string | undefined {
    const escalation = backupEscalation(item, current, retained)
    if (!escalation) return undefined
    if (escalation.cleanups.length)
        return fit(
            "Turns on message cleanup: ",
            escalation.cleanups.map((x) => `messages older than ${age(x.ageMs)} in <#${x.channelId}> will be deleted`),
        )
    return fit(
        "Turns on logs: ",
        escalation.routes.map(
            (route) =>
                `${"category" in route ? route.category : route.eventType.replace(":", " ")} logs go to <#${route.channelId}>`,
        ),
    )
}
// The permission bits the bot needs in a destination
const VIEW_CHANNEL = 1n << 10n,
    SEND_MESSAGES = 1n << 11n,
    MANAGE_MESSAGES = 1n << 13n,
    EMBED_LINKS = 1n << 14n,
    READ_MESSAGE_HISTORY = 1n << 16n
/**
 * Whether the bot can do in the destination what turning the policy or route on needs, from the fresh read of its permissions there, or the
 * reason and the fix. This is what the feature's own gate checks of live Fluxer state: for cleanup that the bot can view the channel, read its
 * history and manage messages, and for logs that it can view it, send, embed links and read history. The person's authority is the verified
 * owner's confirmation, and the owner and DEFCON checks run for every step. A channel the proof did not read is left to the worker, which
 * checks it again
 */
function backupDestinationRefusal(
    item: BackupConfigObject,
    current: BackupConfigObject | null,
    proof: BackupNativeProof | null,
    pendingChannels: Map<string, string> = new Map(),
    retained: Retained = [],
): string | null {
    const escalation = backupEscalation(item, current, retained)
    if (!escalation || !proof) return null
    const cleanup = escalation.cleanups.length > 0,
        need = cleanup
            ? VIEW_CHANNEL | MANAGE_MESSAGES | READ_MESSAGE_HISTORY
            : VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | READ_MESSAGE_HISTORY
    for (const id of new Set(
        cleanup ? escalation.cleanups.map((x) => x.channelId) : escalation.routes.map((x) => x.channelId),
    )) {
        const ref = proof.references.find((x) => x.id === id && x.type === "text")
        if (!id || !ref || pendingChannels.has(id)) continue
        const missing = need & ~BigInt(ref.permissions)
        if (missing)
            return `NeonFlux needs ${permissionNames(missing.toString()).join(", ")} in <#${id}> to ${cleanup ? "clean up" : "post logs"} there. Give it those permissions, then check again`
    }
    return null
}

export const backupImports = {
    backupCurrentConfig,
    backupCurrentXp,
    backupConfigurationCapacity,
    backupConfigReferences,
    backupDestinationRefusal,
    backupFamilyRefusal,
    backupRetainedPolicies,
    backupWarning,
    backupValidateConfigReferences,
}
