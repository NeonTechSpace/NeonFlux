import type { BackupConfigObject, BackupNativeProof, BackupXpObject } from "@neonflux/contracts/backup"
import { eventsReminderMaxMinutes } from "@neonflux/contracts/events"
import type { QueryCtx, MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { backupConfigIdentity, backupHash, canonicalBackupJson } from "./backupDomain.ts"
import { backupClearedRoute, backupConfigRows, projectBackupConfig } from "./backupProjections.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { currentXp, readLeveling, readProfile } from "./levelingStore.ts"
import { permissionNames } from "@neonflux/contracts/permission-names"
import { autoroleIds, safeRole } from "./rolesDomain.ts"
import { rolePolicy } from "./roleClaims.ts"
import { readRolePicker } from "./rolePickerStore.ts"
import { websubConfig } from "./youtubeDomain.ts"
import { HELPDESK_ANSWER_LIMIT } from "@neonflux/contracts/helpdesk"
import { STICKY_LIMIT } from "@neonflux/contracts/sticky"
import { CLEANUP_POLICY_LIMIT } from "@neonflux/contracts/cleanup"
import { VOICE_GENERATOR_LIMIT } from "@neonflux/contracts/voice"
import { YOUTUBE_LIMIT } from "@neonflux/contracts/youtube"
import { object } from "./validation.ts"
import { SERVER_PATTERNS } from "./moderationDomain.ts"
import { cleanupExclusionsRefusal } from "./cleanupDomain.ts"
import { staleEvents } from "./eventsStore.ts"
import { staleSchedules } from "./schedulesStore.ts"

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
/** The key a plan counts its creates of a family by: the family, or a role panel's kind, which has its own limit */
export const backupCapacityKey = (item: BackupConfigObject) =>
    item.family === "panel" ? `panel:${item.value.kind}` : item.family
/**
 * Whether writing a setting takes one of its feature's places: a new one does, and so does a schedule that stopped counting once it had no
 * date left, since a restored schedule counts again
 */
export const backupTakesPlace = (item: BackupConfigObject, row: FamilyRows[number] | null) =>
    !row || (item.family === "schedule" && object(row).released === true)
/** Why the server has no room for one more of this setting. earlier counts the places the plan's earlier segments take for it */
async function backupConfigurationCapacity(
    ctx: Read,
    serverId: string,
    item: BackupConfigObject,
    planned: BackupConfigObject[],
    rows: FamilyRows,
    earlier = 0,
): Promise<string | null> {
    const same = [...planned.filter((x) => x.family === item.family), ...Array.from({ length: earlier }, () => item)]
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
    const limits: Partial<Record<BackupConfigObject["family"], [number, string]>> = {
        voiceGenerator: [VOICE_GENERATOR_LIMIT, "voice generators"],
        sticky: [STICKY_LIMIT, "sticky messages"],
        helpdeskAnswer: [HELPDESK_ANSWER_LIMIT, "saved answers"],
        youtube: [YOUTUBE_LIMIT, "followed YouTube channels"],
    }
    const limit = limits[item.family]
    if (limit && rows.length + same.length >= limit[0])
        return `The server has reached its limit of ${limit[0]} ${limit[1]}`
    // Events and schedules count their live definitions in the feature's settings counter, which release lowers on cancellation and
    // completion. Definitions that ended before release existed still sit in the counter, so they are left out as the features do
    if (item.family === "event" || item.family === "schedule") {
        const state = await ctx.db
            .query(item.family === "event" ? "eventSettings" : "scheduleSettings")
            .withIndex("by_server", (q) => q.eq("serverId", serverId))
            .unique()
        const stale = state ? await (item.family === "event" ? staleEvents : staleSchedules)(ctx, serverId) : 0
        if ((state?.definitions ?? 0) - stale + same.length >= 50)
            return `The server has reached its limit of 50 ${item.family === "event" ? "events" : "schedules"}`
    }
    if (item.family === "cleanupPolicy") {
        const state = await ctx.db
            .query("cleanupSettings")
            .withIndex("by_server", (q) => q.eq("serverId", serverId))
            .unique()
        if (
            rows.length + same.length >= CLEANUP_POLICY_LIMIT ||
            (state?.policies ?? 0) + same.length >= CLEANUP_POLICY_LIMIT
        )
            return `The server has reached its limit of ${CLEANUP_POLICY_LIMIT} cleanup channels`
    }
    return null
}
/**
 * Why a restored automod rule would take the server's rules past the patterns they may hold together, with the rules as the plan's earlier
 * writes leave them. planned holds this segment's writes, rows the server's rules and earlier the patterns that earlier segments' writes add,
 * less those they replace
 */
function backupAutomodPatterns(
    item: BackupConfigObject,
    planned: BackupConfigObject[],
    rows: FamilyRows,
    earlier = 0,
): string | null {
    if (item.family !== "automod") return null
    const written = new Map<string, number>()
    for (const x of [...planned, item]) if (x.family === "automod") written.set(x.value.name, x.value.patterns.length)
    let total = earlier
    for (const row of rows) if (!written.has(String(row.name))) total += (object(row.rule).patterns as unknown[]).length
    for (const count of written.values()) total += count
    return total > SERVER_PATTERNS
        ? `The server's automod rules would hold more than ${SERVER_PATTERNS} patterns together`
        : null
}
/**
 * Why a restored cleanup policy's exclusions would take the server past what it keeps across its cleanup channels, with planned this
 * segment's writes and rows the server's policies
 */
function backupCleanupExclusions(item: BackupConfigObject, planned: BackupConfigObject[], rows: FamilyRows) {
    if (item.family !== "cleanupPolicy") return null
    type Lists = Parameters<typeof cleanupExclusionsRefusal>[1] & { channelId: string }
    const written = new Map<string, Lists>()
    for (const x of planned) if (x.family === "cleanupPolicy") written.set(x.value.channelId, x.value)
    const policies = rows as unknown as Lists[],
        current = policies.find((x) => x.channelId === item.value.channelId) ?? null
    return cleanupExclusionsRefusal(
        current,
        item.value,
        [...policies.filter((x) => !written.has(x.channelId)), ...written.values()].filter(
            (x) => x.channelId !== item.value.channelId,
        ),
    )
}
type BackupReferenceType = "role" | "member" | "category" | "text" | "voice"
/**
 * The roles, members and channels a setting names. safeRole is a role members get, staff a staff role and listed a role in a list of who may
 * use something, which the everyone role cannot be
 */
function backupConfigReferences(
    item: BackupConfigObject,
): { id: string; type: BackupReferenceType; safeRole?: boolean; staff?: boolean; listed?: boolean }[] {
    const refs: ReturnType<typeof backupConfigReferences> = [],
        role = (id: string, safe = false, staff = false, listed = false) =>
            refs.push({
                id,
                type: "role",
                ...(safe ? { safeRole: true } : {}),
                ...(staff ? { staff: true } : {}),
                ...(listed ? { listed: true } : {}),
            }),
        channel = (id: string | null | undefined, type: "category" | "text" | "voice" = "text") => {
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
            if (item.value.privateDataRoleId) role(item.value.privateDataRoleId, false, false, true)
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
            ;[...(item.value.onlyChannelIds ?? []), ...item.value.excludedChannelIds].forEach((id) => channel(id))
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
        case "event":
        case "schedule":
        case "sticky":
        case "youtube":
            channel(item.value.channelId)
            break
        case "showcase":
            channel(item.value.channelId)
            break
        case "voiceGenerator":
            channel(item.value.channelId, "voice")
            channel(item.value.categoryId, "category")
            break
        case "lfg":
            channel(item.value.channelId)
            channel(item.value.generatorChannelId, "voice")
            break
        case "rolepicker":
            item.value.menus.forEach((menu) => menu.roleIds.forEach((id) => role(id, true)))
            break
        // Member IDs in an access list are kept as they are, like the excluded authors of a cleanup policy, so a member who left blocks nothing
        case "access":
            ;[...item.value.allowRoleIds, ...item.value.blockRoleIds].forEach((id) => role(id, false, false, true))
            break
        case "temproles":
            item.value.roles.forEach((x) => role(x.roleId, false, false, true))
            break
        case "onboarding":
            if (item.value.completionRoleId) role(item.value.completionRoleId, true)
            item.value.steps.forEach((step) => step.type === "link" && channel(step.channelId))
            break
        case "helpdesk":
            item.value.forumIds.forEach((id) => channel(id))
            channel(item.value.guardChannelId)
            break
    }
    return refs
}
// A channel, category, role or member that a restored setting uses, as a mention for the preview and restore replies
const referenceName = ({ id, type }: { id: string; type: BackupReferenceType }) =>
    type === "role"
        ? `role <@&${id}>`
        : type === "member"
          ? `member <@${id}>`
          : `${type === "text" ? "channel" : type === "voice" ? "voice channel" : "category"} <#${id}>`
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
        if (ref.type !== "role" && ref.type !== "member" && pendingChannels.get(ref.id) === ref.type) continue
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
        if (ref.listed && ref.id === serverId)
            return "The everyone role cannot be named here. An empty allow list already means everyone"
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
 * Why a restore cannot change a posted role panel's roles under its message as staff do, or null. Only a reaction panel posted at its
 * current revision changes in place, never to one choice, and keeps at least one role. An emoji whose role changes waits for its reactions
 * to clear, and at most 40 wait at once
 */
function backupPostedPanelRefusal(
    item: Extract<BackupConfigObject, { family: "panel" }>,
    row: Record<string, unknown>,
) {
    const published = row.published as Doc<"rolePanels">["published"],
        mappings = row.mappings as Doc<"rolePanels">["mappings"],
        name = item.value.name
    if (!published) return null
    if (
        canonicalBackupJson(item.value.mappings) === canonicalBackupJson(mappings) &&
        item.value.exclusive === row.exclusive
    )
        return null
    if (row.kind !== "reaction" || published.revision !== row.revision)
        return "This role panel's posted message cannot change its roles in place. Withdraw it first, then check again"
    if (item.value.exclusive && row.exclusive !== true)
        return "Switching a posted role panel to one choice needs a new panel message. Withdraw it first, then check again"
    if (!item.value.mappings.length)
        return "A posted role panel needs at least one role. Withdraw it first, then check again"
    const before = new Map(published.mappings.map((x) => [x.emoji, x.roleId])),
        after = new Map(item.value.mappings.map((x) => [x.emoji, x.roleId])),
        changed = [...new Set([...before.keys(), ...after.keys()])].filter(
            (emoji) => before.get(emoji) !== after.get(emoji),
        )
    if (new Set([...(published.pendingClear ?? []), ...changed]).size > 40)
        return `Panel ${name} still has reactions to update. Run !roles reactions ${name} first, then check again`
    return null
}
/**
 * Why a restore may not write this setting even though its references hold, or null. A panel being withdrawn waits for it to finish, a
 * posted panel changes only as staff could change it in place, and a panel keeps its kind and a rule its type
 */
function backupFamilyRefusal(
    item: BackupConfigObject,
    current: BackupConfigObject | null,
    row: Record<string, unknown> | null,
): string | null {
    if (item.family === "panel" && row) {
        if (current?.family === "panel" && current.value.kind !== item.value.kind)
            return "A panel with that name has a different kind"
        if (row.withdrawing === true)
            return "This role panel is being withdrawn, so a restore leaves it alone. Check again once that finished"
        const posted = backupPostedPanelRefusal(item, row)
        if (posted) return posted
    }
    if (item.family === "automod" && current?.family === "automod" && current.value.type !== item.value.type)
        return "An automod rule with that name has a different type"
    // A restore makes or changes only a draft event, so one that members could see or answer stays as it is
    if (item.family === "event" && row && (row.state !== "draft" || row.forgetting === true))
        return "An event with this name is published, cancelled or being forgotten, so a restore leaves it alone. Forget it or rename the archived one first"
    if (item.family === "schedule" && row?.cancelled === true)
        return "A schedule with this name was cancelled, and a cancelled schedule stays cancelled. Forget it first"
    if (item.family === "youtube" && !websubConfig())
        return "YouTube alerts are not set up for this NeonFlux, so it cannot follow YouTube channels"
    return null
}
/**
 * Why a setting that names another one by name cannot be written yet: the voice generator of looking for group and the role panels and
 * menus of the newcomer checklist must exist, or come earlier in the same restore
 */
async function backupDependencyRefusal(
    ctx: Read,
    serverId: string,
    item: BackupConfigObject,
    planned: readonly BackupConfigObject[],
): Promise<string | null> {
    if (item.family === "lfg" && item.value.generatorChannelId) {
        const id = item.value.generatorChannelId
        if (
            !planned.some((x) => x.family === "voiceGenerator" && x.value.channelId === id) &&
            !(await ctx.db
                .query("voiceGenerators")
                .withIndex("by_channel", (q) => q.eq("serverId", serverId).eq("channelId", id))
                .unique())
        )
            return `The voice channel <#${id}> is not a voice generator, so looking for group cannot use it`
    }
    if (item.family === "onboarding")
        for (const step of item.value.steps) {
            if (step.type === "panel") {
                const panel = await ctx.db
                    .query("rolePanels")
                    .withIndex("by_server_name", (q) => q.eq("serverId", serverId).eq("name", step.name))
                    .unique()
                if (
                    !planned.some(
                        (x) => x.family === "panel" && x.value.name === step.name && x.value.kind === "reaction",
                    ) &&
                    panel?.kind !== "reaction"
                )
                    return `The checklist needs the reaction role panel ${step.name}, which the server does not have`
            }
            if (
                step.type === "menu" &&
                !planned.some((x) => x.family === "rolepicker" && x.value.menus.some((m) => m.name === step.name)) &&
                !(await readRolePicker(ctx, serverId)).menus.some((menu) => menu.name === step.name)
            )
                return `The checklist needs the role picker menu ${step.name}, which the server does not have`
        }
    return null
}

type Retained = { channelId: string; ageMs: number; revision?: number }[]
/** The cleanup policies that are on now. A paused cleanup module leaves them on, so turning the module on resumes them */
async function backupRetainedPolicies(ctx: Read, serverId: string): Promise<Retained> {
    return (
        await ctx.db
            .query("cleanupPolicies")
            .withIndex("by_channel", (q) => q.eq("serverId", serverId))
            .take(CLEANUP_POLICY_LIMIT)
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
        posts: [] as string[],
    }
    // A schedule that turns on or moves posts on its dates, and a sticky message posts again below new messages
    if (item.family === "schedule") {
        const was = current?.family === "schedule" ? current.value : null
        return item.value.enabled && (!was?.enabled || was.channelId !== item.value.channelId)
            ? { ...none, posts: [item.value.channelId] }
            : null
    }
    if (item.family === "sticky") {
        const was = current?.family === "sticky" ? current.value : null
        return !was || was.content !== item.value.content ? { ...none, posts: [item.value.channelId] } : null
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
    archived: BackupConfigObject = item,
    row: Record<string, unknown> | null = null,
): string | undefined {
    // The item restores as something other than the archive holds, since its dates passed: A repeat begins again at its next date, and
    // one with no date left returns without dates. An event also leaves out the reminders that would not come for every date
    const from = (calendar: { localMinute: string; zone: string }) =>
        `${calendar.localMinute.replace("T", " ")} ${calendar.zone}`
    if (archived.family === "event" && archived.value.calendar && item.family === "event") {
        const dates = !item.value.calendar
                ? "Its dates passed, so it returns as a draft without a date"
                : item.value.calendar.localMinute !== archived.value.calendar.localMinute
                  ? `Dates that passed are left out, so it returns as a draft from ${from(item.value.calendar)}`
                  : undefined,
            reminders =
                item.value.calendar &&
                item.value.reminderOffsets.length < archived.value.reminderOffsets.length &&
                `Reminders more than ${eventsReminderMaxMinutes(item.value.calendar) / 1440} days before a date are left out, since NeonFlux stores this repeat's dates only that far ahead`
        if (dates || reminders) return [dates, reminders].filter(Boolean).join(". ")
    }
    if (archived.family === "schedule" && archived.value.enabled && item.family === "schedule")
        if (!item.value.enabled) return "Its dates passed, so it returns paused. Give it new dates, then turn it on"
        else if (item.value.calendar.localMinute !== archived.value.calendar.localMinute)
            return backupEscalation(item, current)?.posts.length
                ? `Turns on scheduled posts: they go to <#${item.value.channelId}> from ${from(item.value.calendar)}, and dates that passed are left out`
                : `Dates that passed are left out, so it posts again from ${from(item.value.calendar)}`
    // An archive holds a panel's definition only, so a new one waits for staff to post it, and a posted one changes under its message
    if (item.family === "panel" && !current)
        return `Returns unposted, so members cannot use it until staff post it with !roles publish ${item.value.name} #channel <draft-name>`
    if (
        item.family === "panel" &&
        row?.published !== undefined &&
        current?.family === "panel" &&
        canonicalBackupJson(item.value.mappings) !== canonicalBackupJson(current.value.mappings)
    )
        return `Changes its posted message in place. NeonFlux clears reactions whose role changed now, so members react again, and takes back roles it gave that the panel no longer gives. If clearing fails, !roles reactions ${item.value.name} finishes it`
    if (item.family === "moderation" && item.value.privateDataRoleId) {
        const was = current?.family === "moderation" ? current.value.privateDataRoleId : undefined
        if (was !== item.value.privateDataRoleId)
            return `Lets members with the role <@&${item.value.privateDataRoleId}> view private cases on the website`
    }
    const escalation = backupEscalation(item, current, retained)
    if (!escalation) return undefined
    if (escalation.posts.length)
        return item.family === "sticky"
            ? `Posts a sticky message in <#${escalation.posts[0]}> and posts it again below new messages`
            : `Turns on scheduled posts: they go to <#${escalation.posts[0]}> on its dates`
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
        cleanup
            ? escalation.cleanups.map((x) => x.channelId)
            : [...escalation.routes.map((x) => x.channelId), ...escalation.posts],
    )) {
        const ref = proof.references.find((x) => x.id === id && x.type === "text")
        if (!id || !ref || pendingChannels.has(id)) continue
        const missing = need & ~BigInt(ref.permissions)
        if (missing)
            return `NeonFlux needs ${permissionNames(missing.toString()).join(", ")} in <#${id}> to ${cleanup ? "clean up" : escalation.posts.length ? "post" : "post logs"} there. Give it those permissions, then check again`
    }
    return null
}

export const backupImports = {
    backupAutomodPatterns,
    backupCleanupExclusions,
    backupCurrentConfig,
    backupCurrentXp,
    backupConfigurationCapacity,
    backupConfigReferences,
    backupDependencyRefusal,
    backupDestinationRefusal,
    backupFamilyRefusal,
    backupRetainedPolicies,
    backupWarning,
    backupValidateConfigReferences,
}
