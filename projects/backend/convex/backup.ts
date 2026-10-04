import { v } from "convex/values"
import {
    BACKUP_RESTORE_LIMITS,
    BackupManageRequest,
    BackupPreviewRequest,
    BackupQueryRequest,
    BackupSnapshotRequest,
    BackupWorkRequest,
    backupConfigFamilies,
    backupGain,
    type BackupChange,
    type BackupConfigObject,
    type BackupContext,
    type BackupManageResult,
    type BackupManifest,
    type BackupNativeProof,
    type BackupPreviewResult,
    type BackupQueryResult,
    type BackupSnapshot,
    type BackupStructureObject,
    type BackupWorkResult,
    type BackupXpObject,
} from "@neonflux/contracts/backup"
import { LEVELING_CAP } from "@neonflux/contracts/leveling"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { type MutationCtx, type QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import {
    BACKUP_DISPATCH_MS,
    BACKUP_PLAN_MS,
    BACKUP_RETENTION,
    BACKUP_SETTLE_MS,
    backupChannelSemantic,
    backupContext,
    backupDiff,
    backupHash,
    backupManifest,
    backupNativeProof,
    backupNormalized,
    backupStructure,
    backupSwitchPath,
    canonicalBackupJson,
} from "./backupDomain.ts"
import { backupConfigRows, selectedBackupSnapshot } from "./backupProjections.ts"
import { backupImports } from "./backupImports.ts"
import { backupWriteConfig, backupWriteXp } from "./backupWrites.ts"
import {
    type BackupRead,
    backupConfigMappingsCurrent,
    backupExtraDecision,
    backupGrant,
    backupItemRow,
    backupMappedConfig,
    backupNativeDecision,
    backupOriginCapacity,
    backupOriginRow,
    backupOwner,
    backupPlanOwner,
    backupPlanRow,
    backupPlanUnresolved,
    backupProtected,
    backupRestorableTypes,
    backupRewriteConfig,
    backupSetRetention,
    backupStructureView,
    publicBackupItem,
    publicBackupOrigin,
    publicBackupPlan,
} from "./backupStore.ts"
import { claimToken } from "./rolesDomain.ts"
import { decode, fail, requireServer, source } from "./validation.ts"

function server(serverId: string) {
    requireServer(serverId)
    return serverId
}
const {
    backupConfigurationCapacity,
    backupConfigReferences,
    backupCurrentConfig,
    backupCurrentXp,
    backupDestinationRefusal,
    backupFamilyRefusal,
    backupRetainedPolicies,
    backupValidateConfigReferences,
    backupWarning,
} = backupImports
function native(value: BackupNativeProof | null, serverId: string, context: BackupContext) {
    return value === null ? null : backupNativeProof(value, serverId, context)
}
const terminal = (item: Doc<"backupItems">) =>
    ["created", "updated", "deleted", "skipped", "conflict", "blocked", "failed", "uncertain"].includes(item.state)
export const snapshot = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupSnapshot> => {
        const input = decode(BackupSnapshotRequest, request),
            serverId = server(input.serverId),
            context = backupContext(input.context)
        await backupOwner(ctx, serverId, context)
        return selectedBackupSnapshot(ctx, serverId, input.selected)
    },
})
export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupQueryResult> => {
        const input = decode(BackupQueryRequest, request),
            serverId = server(input.serverId),
            context = backupContext(input.context),
            op = input.operation
        await backupOwner(ctx, serverId, context)
        if (op.type === "plans") {
            const rows = await ctx.db
                .query("backupPlans")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .paginate({ cursor: op.cursor ?? null, numItems: BACKUP_RESTORE_LIMITS.page })
            return {
                type: "plans",
                plans: rows.page
                    .filter((x) => x.ownerId === context.ownerId && x.provider === context.provider)
                    .map(publicBackupPlan),
                ...(!rows.isDone ? { nextCursor: rows.continueCursor } : {}),
            }
        }
        if (op.type === "origins") {
            const provider = op.provider
            if (provider !== context.provider) fail(403, "Provider mismatch")
            const rows = await ctx.db
                .query("backupOrigins")
                .withIndex("by_server", (q) => q.eq("serverId", serverId).eq("provider", provider))
                .paginate({ cursor: op.cursor ?? null, numItems: BACKUP_RESTORE_LIMITS.page })
            return {
                type: "origins",
                origins: rows.page.map(publicBackupOrigin),
                ...(!rows.isDone ? { nextCursor: rows.continueCursor } : {}),
            }
        }
        if (op.type === "item") {
            const { plan, item } = await backupItemRow(ctx, serverId, op.binding)
            backupPlanOwner(plan, context)
            return {
                type: "item",
                item: publicBackupItem(plan, item),
                object:
                    (item.object as BackupConfigObject | BackupXpObject | BackupStructureObject | undefined) ?? null,
            }
        }
        if (op.type === "managed") {
            const channels: Extract<BackupQueryResult, { type: "managed" }>["channels"] = []
            for (const id of new Set(op.channelIds)) {
                const managed = await backupProtected(ctx, serverId, [id])
                if (managed) channels.push({ id, managed })
            }
            return { type: "managed", channels }
        }
        const plan = await backupPlanRow(ctx, serverId, op.binding)
        backupPlanOwner(plan, context)
        if (op.type === "plan") return { type: "plan", plan: publicBackupPlan(plan) }
        const rows = await ctx.db
            .query("backupItems")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .paginate({ cursor: op.cursor ?? null, numItems: BACKUP_RESTORE_LIMITS.page })
        return {
            type: "items",
            items: rows.page.map((x) => publicBackupItem(plan, x)),
            ...(!rows.isDone ? { nextCursor: rows.continueCursor } : {}),
        }
    },
})

type PlannedItem = Omit<Doc<"backupItems">, "_id" | "_creationTime" | "planId">
type DraftItem = Omit<PlannedItem, "itemNo" | "generation" | "state" | "serverId">
/** An item before it has its number: group is its place in the run, and parentId the archive category it sits in */
type Draft = { group: number; parentId: string | null; item: DraftItem; changes: BackupChange[]; bits: bigint }
/** An item with what it changes, which the plan stores beside it */
type Prepared = { item: PlannedItem; changes: BackupChange[] }
type FieldChange = Extract<BackupChange, { kind: "field" }>
type Json = Exclude<FieldChange["before"], undefined>
/** The most a stored list of one item's changes may hold. A larger item is blocked instead of shown in part */
const BACKUP_CHANGES_BYTES = 524288
function backupRestorable(manifest: BackupManifest, serverId: string, context: BackupContext) {
    if (manifest.serverId !== serverId || manifest.provider !== context.provider)
        fail(403, "Same-server and same-provider restore required")
    if (
        manifest.config.length + manifest.xp.length + manifest.structure.length > BACKUP_RESTORE_LIMITS.planItems ||
        new TextEncoder().encode(canonicalBackupJson(manifest)).length > BACKUP_RESTORE_LIMITS.planBytes
    )
        fail(413, "Restore plan exceeds 500 items or 512 KiB")
}
const noPermissions = { allow: "0", deny: "0" }
/** The leaf rows of what changes between two values. A setting that turns on is marked */
const fieldChanges = (before: unknown, after: unknown): FieldChange[] =>
    backupDiff(before, after).map((row) => ({
        kind: "field",
        path: row.path,
        ...("before" in row ? { before: row.before as Json } : {}),
        ...("after" in row ? { after: row.after as Json } : {}),
        ...(backupSwitchPath(row.path) && row.after === true && row.before !== true ? { on: true as const } : {}),
    }))
/** The names of the top-level settings that changed, at most ten. A changed overwrite is named permissions */
const changedNames = (changes: BackupChange[]) =>
    [...new Set(changes.map((x) => (x.kind === "field" ? x.path.split(/[.[]/)[0]! : "permissions")))]
        .filter((name) => name !== "linkChannels")
        .slice(0, 10)
const perms = (o?: { allow: string; deny: string }) => (o ? { allow: o.allow, deny: o.deny } : noPermissions)
const channelFields = (channel: BackupStructureObject) => {
    const { overwrites: _overwrites, sourceId: _id, capturedAt: _at, managed: _managed, ...fields } = channel
    return fields
}
/** Overwrites left out because their role or member is gone. before holds what the archive had for them */
const droppedChanges = (dropped: BackupStructureObject["overwrites"]): BackupChange[] =>
    dropped.map((o) => ({
        kind: "overwrite",
        id: o.id,
        type: o.type,
        before: perms(o),
        after: noPermissions,
        gain: "0",
        dropped: true,
    }))
/**
 * What a channel changes from before, or brings when it is created: its settings and each overwrite with the permissions it gives against what
 * was there, none at all for a new channel. dropped are the overwrites of a role or member that is gone, and follows the channels of a type a
 * restore does not archive that a category's permission change also reaches
 */
function channelDiff(
    before: BackupStructureObject | undefined,
    after: BackupStructureObject,
    dropped: BackupStructureObject["overwrites"] = [],
    follows: readonly string[] = [],
) {
    const was = new Map((before?.overwrites ?? []).map((o) => [o.id, o])),
        now = new Map(after.overwrites.map((o) => [o.id, o])),
        changes: BackupChange[] = fieldChanges(before && channelFields(before), channelFields(after))
    let gain = 0n
    for (const id of [...new Set([...was.keys(), ...now.keys()])].sort()) {
        const old = was.get(id),
            next = now.get(id)
        if (old && next && old.allow === next.allow && old.deny === next.deny) continue
        const granted = backupGain(perms(old), perms(next))
        gain |= granted
        changes.push({
            kind: "overwrite",
            id,
            type: (next ?? old)!.type,
            before: perms(old),
            after: perms(next),
            gain: granted.toString(),
        })
    }
    changes.push(...droppedChanges(dropped))
    for (const name of follows)
        changes.push({
            kind: "field",
            path: `linkChannels[${name}]`,
            before: before!.overwrites as Json,
            after: after.overwrites as Json,
        })
    return { changes, gain }
}
const deleteWarning = "Deletes the channel with its messages, files, webhooks and invites, which cannot be undone"
/** What a restore plan does with each archive item against the server as the fresh native evidence shows it, with what each item changes.
 *  Previews and plans are the same thing, so there is one decision. It only reads */
async function backupPlanItems(
    ctx: BackupRead,
    serverId: string,
    manifest: BackupManifest,
    proof: BackupNativeProof | null,
    match: boolean,
) {
    const counts = { create: 0, update: 0, delete: 0, skip: 0, blocked: 0 },
        prepared: Prepared[] = [],
        pendingChannels = new Map<string, string>(),
        gain = { items: 0, bits: 0n, switches: 0 }
    const add = (item: DraftItem, changes: BackupChange[], bits = 0n) => {
        // A list too large to show would be cut, so the item is blocked instead
        const tooLarge = new TextEncoder().encode(JSON.stringify(changes)).length > BACKUP_CHANGES_BYTES
        const shown = tooLarge ? [] : changes,
            on = shown.filter((x) => x.kind === "field" && x.on).length,
            granted = bits !== 0n && !tooLarge
        const decided = tooLarge
            ? { ...item, disposition: "blocked" as const, reason: "Its changes are too large to show" }
            : item
        const named = decided.disposition === "update" || decided.disposition === "skip" ? changedNames(shown) : []
        const row: PlannedItem = {
            ...decided,
            serverId,
            itemNo: prepared.length + 1,
            generation: 1,
            state: "planned",
            ...(named.length ? { changed: named } : {}),
            ...(granted ? { gain: true as const } : {}),
            ...(on ? { on: true as const } : {}),
        }
        counts[row.disposition]++
        if (granted) {
            gain.items++
            gain.bits |= bits
        }
        gain.switches += on
        prepared.push({ item: row, changes: shown })
    }
    // The channels run in this order: category creates, category updates, channel creates, channel updates, channel deletes and category deletes.
    // Creates run before deletes, so a full server fails safely instead of after destruction, and a category changes before its channels
    const drafts: Draft[] = [],
        view = await backupStructureView(ctx, { serverId, provider: manifest.provider }, manifest.structure, match),
        cascaded = new Set<string>(),
        moving = new Set<string>()
    for (const object of [...manifest.structure].sort(
        (a, b) => Number(b.type === "category") - Number(a.type === "category") || a.sourceId.localeCompare(b.sourceId),
    )) {
        const decision = await backupNativeDecision(
                ctx,
                { serverId, provider: manifest.provider },
                object,
                proof,
                view,
            ),
            { disposition, observed, desired } = decision
        // Configuration names an announcement channel as a message channel
        if (disposition === "create") {
            pendingChannels.set(object.sourceId, object.type === "announcement" ? "text" : object.type)
            if (object.type === "category") view.pending.add(object.sourceId)
        }
        for (const id of decision.cascaded ?? []) cascaded.add(id)
        // An update that keeps the channel in its category does not take it out of it
        if (disposition === "update" && observed!.parentId !== desired!.parentId) moving.add(decision.mappedId!)
        const brings =
            disposition === "create"
                ? channelDiff(undefined, desired!, decision.dropped)
                : disposition === "update"
                  ? channelDiff(observed, desired!, decision.dropped, decision.follows)
                  : { changes: disposition === "skip" ? droppedChanges(decision.dropped ?? []) : [], gain: 0n }
        drafts.push({
            group: (object.type === "category" ? 0 : 2) + Number(disposition !== "create"),
            parentId: object.parentId,
            item: {
                category: "structure",
                family: "structure",
                sourceId: object.sourceId,
                disposition,
                reason: decision.reason,
                mappedId: decision.mappedId,
                expectedHash: decision.expectedHash,
                name: object.name,
                desiredHash: decision.desiredHash ?? (await backupHash(backupChannelSemantic(object))),
                dependencyItemNo: null,
                object,
                // After a category's change reaches a channel that follows it, the channel is in a second state that its own update accepts
                ...(disposition === "update" && cascaded.has(decision.mappedId!)
                    ? {
                          cascadeHash: await backupHash(
                              backupChannelSemantic({ ...observed!, overwrites: desired!.overwrites }),
                          ),
                      }
                    : {}),
            },
            changes: brings.changes,
            bits: brings.gain,
        })
    }
    if (match && manifest.selected.includes("structure") && proof) {
        const leaving = new Set(moving)
        // Channels first, then categories, which only go once nothing is left in them
        for (const extra of proof.channels
            .filter((c) => !view.live.has(c.id) && backupRestorableTypes.includes(c.type))
            .sort(
                (a, b) => Number(a.type === "category") - Number(b.type === "category") || a.id.localeCompare(b.id),
            )) {
            const decision = await backupExtraDecision(ctx, serverId, proof, extra, leaving),
                deletes = decision.disposition === "delete"
            if (deletes) leaving.add(extra.id)
            drafts.push({
                group: extra.type === "category" ? 5 : 4,
                parentId: null,
                item: {
                    category: "structure",
                    family: "structure",
                    sourceId: extra.id,
                    disposition: decision.disposition,
                    reason: decision.reason,
                    mappedId: deletes ? extra.id : null,
                    expectedHash: decision.expectedHash,
                    ...(deletes ? { warning: deleteWarning } : {}),
                    extra: true as const,
                    name: extra.name,
                    desiredHash: await backupHash({ delete: extra.id }),
                    dependencyItemNo: null,
                    // Only what the listing shows of it, which names the channel for the claim
                    object: backupStructure({
                        sourceId: extra.id,
                        type: extra.type as BackupStructureObject["type"],
                        name: extra.name,
                        parentId: extra.parentId,
                        overwrites: [],
                        capturedAt: proof.observedAt,
                    }),
                },
                changes: [],
                bits: 0n,
            })
        }
    }
    // A channel that is created or moved into a category waits for it, and a category that is created is needed before anything moves into it
    drafts.sort((a, b) => a.group - b.group)
    const numbers = new Map(drafts.map((d, i) => [d.item.sourceId, { itemNo: i + 1, disposition: d.item.disposition }]))
    for (const draft of drafts) {
        const parent = draft.parentId === null ? undefined : numbers.get(draft.parentId)
        add(
            {
                ...draft.item,
                dependencyItemNo:
                    parent &&
                    (draft.item.disposition === "update"
                        ? parent.disposition === "create"
                        : ["create", "skip", "update"].includes(parent.disposition))
                        ? parent.itemNo
                        : null,
            },
            draft.changes,
            draft.bits,
        )
    }
    // Each family is read once, since every setting of a large family would otherwise read all of its rows again
    const families = new Map<BackupConfigObject["family"], Awaited<ReturnType<typeof backupConfigRows>>>()
    for (const object of [...manifest.config].sort(
        (a, b) =>
            backupConfigFamilies.indexOf(a.family) - backupConfigFamilies.indexOf(b.family) ||
            a.sourceId.localeCompare(b.sourceId),
    )) {
        if (!families.has(object.family))
            families.set(object.family, await backupConfigRows(ctx, serverId, object.family))
        const rows = families.get(object.family)!
        const configMappings: NonNullable<Doc<"backupItems">["configMappings"]> = []
        for (const sourceId of new Set(
            backupConfigReferences(object)
                .filter((x) => x.type === "text" || x.type === "category")
                .map((x) => x.id),
        )) {
            const origin = await backupOriginRow(ctx, serverId, manifest.provider, sourceId),
                pending = prepared.find(
                    (x) =>
                        x.item.category === "structure" &&
                        x.item.sourceId === sourceId &&
                        x.item.disposition === "create",
                )
            configMappings.push({
                sourceId,
                targetId: pending ? null : (origin?.mappedId ?? sourceId),
                targetItemNo: pending?.item.itemNo ?? null,
            })
        }
        const mapped = await backupMappedConfig(
                ctx,
                { serverId, provider: manifest.provider },
                object,
                pendingChannels,
            ),
            effective = mapped ?? object
        const pendingTarget =
            object.family === "cleanupPolicy" &&
            configMappings.some((x) => x.sourceId === object.value.channelId && x.targetId === null)
        const current = pendingTarget
                ? { row: null, value: null, hash: await backupHash(null) }
                : await backupCurrentConfig(ctx, serverId, effective, rows),
            identical =
                current.value &&
                !configMappings.some((x) => x.targetId === null) &&
                canonicalBackupJson(backupNormalized(current.value)) ===
                    canonicalBackupJson(backupNormalized(effective))
        const retained = object.family === "cleanup" ? await backupRetainedPolicies(ctx, serverId) : []
        const refused = !mapped
            ? "It uses a channel from an earlier restore that NeonFlux could not confirm"
            : identical
              ? null
              : (backupFamilyRefusal(effective, current.value, current.row) ??
                (await backupValidateConfigReferences(ctx, serverId, effective, proof, pendingChannels)) ??
                backupDestinationRefusal(effective, current.value, proof, pendingChannels, retained) ??
                (current.row
                    ? null
                    : await backupConfigurationCapacity(
                          ctx,
                          serverId,
                          effective,
                          prepared
                              .filter((x) => x.item.category === "config" && x.item.disposition === "create")
                              .map((x) => x.item.object as BackupConfigObject),
                          rows,
                      )))
        const disposition = refused
            ? ("blocked" as const)
            : identical
              ? ("skip" as const)
              : current.row
                ? ("update" as const)
                : ("create" as const)
        const warning =
            disposition === "create" || disposition === "update"
                ? backupWarning(effective, current.value, retained)
                : undefined
        add(
            {
                category: "config",
                family: object.family,
                sourceId: object.sourceId,
                disposition,
                reason: refused,
                ...(warning ? { warning } : {}),
                expectedHash: current.hash,
                desiredHash: await backupHash(effective),
                dependencyItemNo: null,
                mappedId: null,
                object,
                configMappings,
            },
            disposition === "create" || disposition === "update"
                ? fieldChanges(
                      current.value && backupNormalized(current.value).value,
                      backupNormalized(effective).value,
                  )
                : [],
        )
    }
    const xpState = await ctx.db
        .query("levelingSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    for (const object of manifest.xp) {
        const current = await backupCurrentXp(ctx, serverId, object),
            full =
                !current.row &&
                (xpState?.profiles ?? 0) +
                    prepared.filter((x) => x.item.category === "xp" && x.item.disposition === "create").length >=
                    LEVELING_CAP,
            disposition = full
                ? ("blocked" as const)
                : !current.row
                  ? ("create" as const)
                  : current.xp === object.xp
                    ? ("skip" as const)
                    : ("update" as const)
        add(
            {
                category: "xp",
                family: "xp",
                sourceId: object.sourceId,
                disposition,
                reason: full ? "The server has reached its limit of 50,000 members with XP" : null,
                expectedHash: current.hash,
                desiredHash: await backupHash(object),
                dependencyItemNo: null,
                mappedId: null,
                object,
            },
            disposition === "create" || disposition === "update"
                ? fieldChanges(current.row ? { xp: current.xp } : undefined, { xp: object.xp })
                : [],
        )
    }
    if (prepared.length > BACKUP_RESTORE_LIMITS.planItems)
        fail(413, `Match fully would make ${prepared.length} items, the limit is ${BACKUP_RESTORE_LIMITS.planItems}`)
    return { counts, prepared, gain: { ...gain, bits: gain.bits.toString() } }
}
/** Deletes a plan that was never confirmed, with its items and what they change. Nothing ran from it, so no anchor needs to stay */
async function backupDeletePlan(ctx: MutationCtx, plan: Doc<"backupPlans">) {
    for (const table of ["backupItems", "backupChanges"] as const)
        for (const row of await ctx.db
            .query(table)
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .take(BACKUP_RESTORE_LIMITS.planItems + 1))
            await ctx.db.delete(row._id)
    await ctx.db.delete(plan._id)
}
/** Makes the restore plan of an archive against the server now: Its items and what they change are stored with the plan */
async function createBackupPlan(
    ctx: MutationCtx,
    serverId: string,
    context: BackupContext,
    manifest: BackupManifest,
    archiveDigest: string,
    proof: BackupNativeProof | null,
    match: boolean,
) {
    if (
        (
            await ctx.db
                .query("backupPlans")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .take(BACKUP_RESTORE_LIMITS.plans + 1)
        ).length >= BACKUP_RESTORE_LIMITS.plans
    )
        fail(429, "Restore plan capacity reached")
    const now = Date.now(),
        manifestDigest = await backupHash(manifest),
        { counts, prepared, gain } = await backupPlanItems(ctx, serverId, manifest, proof, match)
    const planHash = await backupHash({
            ownerId: context.ownerId,
            provider: context.provider,
            archiveDigest,
            manifestDigest,
            expiresAt: now + BACKUP_PLAN_MS,
            match,
            items: prepared.map((x) => x.item),
        }),
        id = await ctx.db.insert("backupPlans", {
            serverId,
            ownerId: context.ownerId,
            provider: manifest.provider,
            backupId: manifest.backupId,
            archiveDigest,
            manifestDigest,
            planHash,
            revision: 1,
            createdAt: now,
            expiresAt: now + BACKUP_PLAN_MS,
            cleanupAt: now + BACKUP_PLAN_MS + BACKUP_RETENTION,
            itemCount: prepared.length,
            counts,
            gain,
            match,
            forgotten: false,
        })
    for (const { item, changes } of prepared) {
        await ctx.db.insert("backupItems", { ...item, planId: id })
        if (changes.length) await ctx.db.insert("backupChanges", { serverId, planId: id, itemNo: item.itemNo, changes })
    }
    return (await ctx.db.get(id))!
}

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupManageResult> => {
        const input = decode(BackupManageRequest, request),
            identity = source(input, Date.now()),
            context = backupContext(input.context),
            op = input.operation,
            serverId = identity.serverId
        await backupOwner(ctx, serverId, context)
        const plan = await backupPlanRow(ctx, serverId, op.binding)
        backupPlanOwner(plan, context)
        if (op.type === "confirm") {
            if (plan.forgotten || Date.now() >= plan.expiresAt) fail(409, "Restore plan expired or forgotten")
            if (plan.confirmedAt !== undefined)
                return { type: "confirmed", duplicate: true, plan: publicBackupPlan(plan) }
            await ctx.db.patch(plan._id, { confirmedAt: Date.now() })
            return { type: "confirmed", duplicate: false, plan: publicBackupPlan((await ctx.db.get(plan._id))!) }
        }
        if (await backupPlanUnresolved(ctx, plan._id)) fail(409, "Unresolved restore anchors retained")
        const items = await ctx.db
            .query("backupItems")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .take(BACKUP_RESTORE_LIMITS.planItems + 1)
        for (const item of items)
            await ctx.db.patch(item._id, {
                object: undefined,
                desiredChannel: undefined,
                fromChannel: undefined,
                returnedChannel: undefined,
                ...(item.state === "planned"
                    ? {
                          state: "blocked",
                          reason: "The restore plan was forgotten",
                          finishedAt: Date.now(),
                          noDispatch: true,
                      }
                    : {}),
            })
        for (const row of await ctx.db
            .query("backupChanges")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .take(BACKUP_RESTORE_LIMITS.planItems + 1))
            await ctx.db.delete(row._id)
        await ctx.db.patch(plan._id, { forgotten: true })
        await backupSetRetention(ctx, plan)
        return { type: "forgotten", plan: publicBackupPlan((await ctx.db.get(plan._id))!) }
    },
})

async function updated(
    ctx: MutationCtx,
    plan: Doc<"backupPlans">,
    item: Doc<"backupItems">,
): Promise<BackupWorkResult> {
    return { type: "item", item: publicBackupItem(plan, (await ctx.db.get(item._id))!) }
}
async function block(
    ctx: MutationCtx,
    plan: Doc<"backupPlans">,
    item: Doc<"backupItems">,
    reason: string,
    state: "blocked" | "conflict" = "blocked",
) {
    if (item.claimedAt !== undefined) fail(409, "Claimed native work cannot be classified as undispatched")
    await ctx.db.patch(item._id, { state, reason, finishedAt: Date.now(), noDispatch: true })
    if (item.originId) {
        const origin = await ctx.db.get(item.originId)
        if (origin?.state === "reserved" && origin.planId === plan._id && origin.itemNo === item.itemNo)
            await ctx.db.patch(origin._id, { state: "failed", noDispatch: true, mappedId: null })
    }
    await backupSetRetention(ctx, plan)
    return updated(ctx, plan, item)
}
/** The answer of the bot to an update or a delete of a channel that it claimed: the item settles as it says, and no origin is involved */
async function nativeOutcome(
    ctx: MutationCtx,
    plan: Doc<"backupPlans">,
    item: Doc<"backupItems">,
    op: Extract<BackupWorkRequest["operation"], { type: "outcome" }>,
    now: number,
) {
    const verb = item.disposition === "update" ? "updated" : "deleted",
        { mappedId, channel } = op
    if (item.state !== "claimed") {
        if (item.state === op.outcome && item.mappedId === (mappedId ?? item.mappedId)) return updated(ctx, plan, item)
        fail(409, "Immutable restore outcome already recorded")
    }
    if (
        (op.outcome !== verb && op.outcome !== "failed" && op.outcome !== "uncertain") ||
        (op.noDispatch && op.outcome !== "failed") ||
        (mappedId !== null && mappedId !== item.mappedId) ||
        (channel && channel.sourceId !== item.mappedId) ||
        (op.outcome === "updated" &&
            (!channel ||
                canonicalBackupJson(backupChannelSemantic(channel)) !==
                    canonicalBackupJson(backupChannelSemantic(item.desiredChannel!)))) ||
        (op.outcome === "deleted" && channel)
    )
        fail(409, "Native response does not bind the claimed channel")
    await ctx.db.patch(item._id, {
        state: op.outcome,
        finishedAt: now,
        ...(channel ? { returnedChannel: channel } : {}),
        ...(op.noDispatch ? { noDispatch: true } : {}),
        ...(op.outcome === "failed" || op.outcome === "uncertain"
            ? {
                  reason:
                      op.reason ??
                      (op.outcome === "failed"
                          ? "Fluxer did not apply this"
                          : "NeonFlux could not confirm whether this was applied"),
              }
            : {}),
    })
    await backupSetRetention(ctx, plan)
    return updated(ctx, plan, item)
}
/**
 * Claims an update or delete straight from planned. The decision runs again on the fresh evidence: What has settled since needs no write, what
 * changed since the preview is a conflict, and a claim hands the bot the channel as it is now, which it must still find before it writes
 */
async function claimNative(
    ctx: MutationCtx,
    plan: Doc<"backupPlans">,
    item: Doc<"backupItems">,
    context: BackupContext,
    proof: BackupNativeProof,
    token: string,
    now: number,
): Promise<BackupWorkResult> {
    if (item.state === "claimed")
        return { type: "grant", item: publicBackupItem(plan, item), grant: backupGrant(plan, item), claimed: false }
    if (item.dependencyItemNo !== null) {
        const parent = await ctx.db
            .query("backupItems")
            .withIndex("by_number", (q) =>
                q.eq("serverId", plan.serverId).eq("planId", plan._id).eq("itemNo", item.dependencyItemNo!),
            )
            .unique()
        if (!parent || !["created", "skipped", "updated"].includes(parent.state) || !parent.mappedId)
            return block(ctx, plan, item, "Its category was not created or confirmed")
    }
    const settle = async (state: "updated" | "deleted" | "skipped") => {
        await ctx.db.patch(item._id, { state, finishedAt: now, noDispatch: true })
        return updated(ctx, plan, item)
    }
    const object = backupStructure(item.object),
        changed = (reason?: string | null) =>
            block(ctx, plan, item, reason ?? "The channel changed since the preview", "conflict")
    let desired: BackupStructureObject, from: BackupStructureObject
    if (item.disposition === "delete") {
        const extra = proof.channels.find((c) => c.id === item.sourceId),
            observation = proof.observations.find((x) => x.sourceId === item.sourceId)
        if (!extra && observation?.status === "absent") return settle("deleted")
        if (!extra || observation?.status !== "present")
            return block(ctx, plan, item, "NeonFlux could not read the channel it was to delete")
        const decision = await backupExtraDecision(ctx, plan.serverId, proof, extra, new Set())
        if (decision.disposition === "skip") return settle("skipped")
        if (decision.disposition === "blocked") return block(ctx, plan, item, decision.reason!)
        if (decision.expectedHash !== item.expectedHash) return changed()
        desired = from = observation.channel!
    } else {
        // A category's decision compares the channels that follow it with the archive's, which are the plan's other channel items
        const archive =
                object.type === "category"
                    ? (
                          await ctx.db
                              .query("backupItems")
                              .withIndex("by_plan", (q) => q.eq("planId", plan._id))
                              .take(BACKUP_RESTORE_LIMITS.planItems + 1)
                      ).flatMap((x) =>
                          x.category === "structure" && !x.extra && x.object ? [backupStructure(x.object)] : [],
                      )
                    : [],
            decision = await backupNativeDecision(
                ctx,
                plan,
                object,
                proof,
                await backupStructureView(ctx, plan, archive, plan.match),
            )
        if (decision.disposition === "blocked") return block(ctx, plan, item, decision.reason!)
        if (decision.disposition === "skip") return settle(decision.observed ? "updated" : "skipped")
        if (decision.disposition === "create") return changed("The channel is gone since the preview")
        if (decision.expectedHash !== item.expectedHash && decision.expectedHash !== item.cascadeHash) return changed()
        if (decision.desiredHash !== item.desiredHash) return changed("What it would restore changed since the preview")
        desired = decision.desired!
        from = decision.observed!
    }
    await ctx.db.patch(item._id, {
        state: "claimed",
        claimedAt: now,
        claimToken: token,
        desiredChannel: desired,
        fromChannel: from,
        botId: context.botId,
        dispatchExpiresAt: Math.min(plan.expiresAt, now + BACKUP_DISPATCH_MS),
        mappedId: from.sourceId,
    })
    await ctx.db.patch(plan._id, { cleanupAt: undefined })
    const claimed = (await ctx.db.get(item._id))!
    return { type: "grant", item: publicBackupItem(plan, claimed), grant: backupGrant(plan, claimed), claimed: true }
}
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupWorkResult> => {
        const input = decode(BackupWorkRequest, request),
            serverId = server(input.serverId),
            op = input.operation,
            { plan, item } = await backupItemRow(ctx, serverId, op.binding),
            now = Date.now()
        if (op.type === "outcome") {
            if (
                item.category !== "structure" ||
                item.claimedAt === undefined ||
                item.claimToken !== claimToken(op.claimToken)
            )
                fail(409, "Restore claim capability mismatch")
            if (item.disposition !== "create") return nativeOutcome(ctx, plan, item, op, now)
            const { mappedId, channel } = op
            if (
                !item.originId ||
                (op.outcome !== "created" && op.outcome !== "failed" && op.outcome !== "uncertain") ||
                (channel && mappedId === null) ||
                (op.outcome === "created" && !channel) ||
                (mappedId && !channel && op.outcome !== "uncertain") ||
                (op.noDispatch && (mappedId || op.outcome !== "failed"))
            )
                fail(400, "Invalid native creation response")
            if (
                channel &&
                (channel.sourceId !== mappedId ||
                    (op.outcome === "created" &&
                        canonicalBackupJson(backupChannelSemantic(channel)) !==
                            canonicalBackupJson(backupChannelSemantic(item.desiredChannel!))))
            )
                fail(409, "Native response does not bind exact creation snapshot")
            if (item.mappedId && item.mappedId !== mappedId) fail(409, "Conflicting native result identity")
            if (
                item.historicalOutcome === op.outcome &&
                item.mappedId === mappedId &&
                Boolean(item.noDispatch) === Boolean(op.noDispatch)
            )
                return updated(ctx, plan, item)
            const origin = await ctx.db.get(item.originId)
            if (
                !origin ||
                origin.planId !== plan._id ||
                origin.itemNo !== item.itemNo ||
                origin.generation !== item.generation
            )
                fail(409, "Origin generation changed")
            if (item.historicalOutcome !== undefined) {
                // A late identity-bearing callback keeps the original uncertain outcome
                if (
                    item.historicalOutcome === "uncertain" &&
                    mappedId &&
                    !op.noDispatch &&
                    (item.mappedId === null || item.mappedId === mappedId)
                ) {
                    if (
                        item.returnedChannel &&
                        channel &&
                        canonicalBackupJson(item.returnedChannel) !== canonicalBackupJson(channel)
                    )
                        fail(409, "Conflicting late native snapshot")
                    await ctx.db.patch(item._id, { mappedId, ...(channel ? { returnedChannel: channel } : {}) })
                    await ctx.db.patch(origin._id, { mappedId })
                    return updated(ctx, plan, item)
                }
                fail(409, "Immutable restore outcome already recorded")
            }
            await ctx.db.patch(item._id, {
                state: op.outcome,
                historicalOutcome: op.outcome,
                mappedId,
                finishedAt: now,
                ...(channel ? { returnedChannel: channel } : {}),
                ...(op.noDispatch ? { noDispatch: true } : {}),
            })
            await ctx.db.patch(origin._id, {
                state: op.outcome,
                mappedId,
                ...(op.noDispatch ? { noDispatch: true } : {}),
            })
            await backupSetRetention(ctx, plan)
            return updated(ctx, plan, item)
        }
        const context = backupContext(op.context)
        backupPlanOwner(plan, context)
        await backupOwner(ctx, serverId, context)
        if (op.type === "reconcile") {
            const proof = backupNativeProof(op.native, serverId, context)
            if (
                item.category !== "structure" ||
                item.disposition !== "create" ||
                !item.mappedId ||
                !item.originId ||
                item.claimedAt === undefined ||
                now < (item.dispatchExpiresAt ?? plan.expiresAt) + BACKUP_SETTLE_MS
            )
                fail(409, "Known response-bound identity and closed dispatch required")
            const observation = proof.observations.find((x) => x.sourceId === item.mappedId)
            if (!observation || observation.status === "unknown")
                fail(409, "Exact native identity observation required")
            if (observation.status === "present" && observation.channel!.sourceId !== item.mappedId)
                fail(409, "Observation identity mismatch")
            const resolution =
                observation.status === "absent"
                    ? ("absent" as const)
                    : canonicalBackupJson(backupChannelSemantic(observation.channel!)) ===
                        canonicalBackupJson(backupChannelSemantic(item.desiredChannel!))
                      ? ("match" as const)
                      : ("conflict" as const)
            const origin = await ctx.db.get(item.originId)
            if (!origin || origin.planId !== plan._id || origin.itemNo !== item.itemNo)
                fail(409, "Origin binding changed")
            await ctx.db.patch(item._id, { resolution })
            await ctx.db.patch(origin._id, {
                resolved: resolution,
                ...(resolution === "match" ? { state: "created" } : {}),
            })
            await backupSetRetention(ctx, plan)
            return updated(ctx, plan, item)
        }
        if (terminal(item)) return updated(ctx, plan, item)
        backupPlanOwner(plan, context, true)
        await backupOwner(ctx, serverId, context, false)
        const proof = native(op.native, serverId, context)
        if (item.disposition === "blocked") return block(ctx, plan, item, item.reason ?? "The preview left this out")
        if (op.type === "apply") {
            if (item.category === "structure") {
                if (item.disposition !== "skip") fail(400, "A channel write requires reserve and claim")
                // A channel that a match restore leaves alone is skipped as it was shown. An archive channel is decided again
                const decision = item.extra
                    ? undefined
                    : await backupNativeDecision(
                          ctx,
                          plan,
                          backupStructure(item.object),
                          proof,
                          await backupStructureView(ctx, plan, [], plan.match),
                      )
                if (decision && (decision.disposition !== "skip" || decision.expectedHash !== item.expectedHash))
                    return block(
                        ctx,
                        plan,
                        item,
                        decision.reason ?? "The channel changed since the preview",
                        "conflict",
                    )
                await ctx.db.patch(item._id, {
                    state: "skipped",
                    ...(decision?.mappedId ? { mappedId: decision.mappedId } : {}),
                    finishedAt: now,
                    noDispatch: true,
                })
                return updated(ctx, plan, item)
            }
            const writes = item.disposition === "create" || item.disposition === "update"
            let write: { category: "xp"; object: BackupXpObject } | { category: "config"; object: BackupConfigObject }
            if (item.category === "xp") {
                const object = item.object as BackupXpObject,
                    current = await backupCurrentXp(ctx, serverId, object)
                if (current.hash !== item.expectedHash)
                    return block(ctx, plan, item, "The member's XP changed since the preview", "conflict")
                write = { category: "xp", object }
            } else {
                const object = await backupMappedConfig(ctx, plan, item.object)
                if (!object)
                    return block(
                        ctx,
                        plan,
                        item,
                        "It uses a channel from an earlier restore that NeonFlux could not confirm",
                    )
                if (!(await backupConfigMappingsCurrent(ctx, plan, item.configMappings ?? [])))
                    return block(ctx, plan, item, "A channel it uses changed since the preview", "conflict")
                const preview = await backupRewriteConfig(
                    item.object,
                    async (id) => item.configMappings?.find((x) => x.sourceId === id)?.targetId ?? id,
                )
                if ((await backupHash(preview)) !== item.desiredHash)
                    return block(ctx, plan, item, "What it would restore changed since the preview", "conflict")
                const rows = await backupConfigRows(ctx, serverId, object.family),
                    current = await backupCurrentConfig(ctx, serverId, object, rows)
                if (current.hash !== item.expectedHash)
                    return block(
                        ctx,
                        plan,
                        item,
                        "The server's settings for this changed since the preview",
                        "conflict",
                    )
                if (writes) {
                    const denied =
                        backupFamilyRefusal(object, current.value, current.row) ??
                        (await backupValidateConfigReferences(ctx, serverId, object, proof)) ??
                        backupDestinationRefusal(
                            object,
                            current.value,
                            proof,
                            undefined,
                            object.family === "cleanup" ? await backupRetainedPolicies(ctx, serverId) : [],
                        ) ??
                        (item.disposition === "create"
                            ? await backupConfigurationCapacity(ctx, serverId, object, [], rows)
                            : null)
                    if (denied) return block(ctx, plan, item, denied)
                }
                write = { category: "config", object }
            }
            if (!writes) {
                await ctx.db.patch(item._id, { state: "skipped", finishedAt: now, noDispatch: true })
                return updated(ctx, plan, item)
            }
            const writer = {
                ctx,
                serverId,
                ownerId: plan.ownerId,
                key: `backup:${plan._id}:${item.itemNo}`,
                roles: (proof?.references ?? [])
                    .filter((x) => x.type === "role")
                    .map((x) => ({
                        ...(x.originServerId !== undefined ? { originServerId: x.originServerId } : {}),
                        roleId: x.id,
                        permissions: x.permissions,
                        botCanManage: x.botCanManage,
                        actorCanManage: x.actorCanManage,
                    })),
                now,
            }
            // The feature's own rules ran at the plan and again just above, so what is left to refuse is a race. It undoes the whole step
            if (write.category === "xp") await backupWriteXp(writer, write.object)
            else await backupWriteConfig(writer, write.object)
            await ctx.db.patch(item._id, {
                state: item.disposition === "create" ? "created" : "updated",
                finishedAt: now,
                noDispatch: true,
            })
            return updated(ctx, plan, item)
        }
        if (item.category !== "structure" || item.disposition === "skip" || !proof)
            fail(400, "Native evidence required")
        if (item.disposition !== "create") {
            if (op.type !== "claim") fail(400, "An update or delete needs claim")
            return claimNative(ctx, plan, item, context, proof, claimToken(op.claimToken), now)
        }
        if (item.state === "claimed")
            return { type: "grant", item: publicBackupItem(plan, item), grant: backupGrant(plan, item), claimed: false }
        const original = backupStructure(item.object),
            decision = await backupNativeDecision(
                ctx,
                plan,
                original,
                proof,
                await backupStructureView(ctx, plan, [], plan.match),
                item,
            )
        if (decision.disposition !== "create")
            return block(
                ctx,
                plan,
                item,
                decision.reason ?? "The original channel exists again",
                decision.disposition === "blocked" ? "blocked" : "conflict",
            )
        if (decision.desiredHash !== item.desiredHash)
            return block(ctx, plan, item, "What it would restore changed since the preview", "conflict")
        const channel = decision.desired!
        if (item.dependencyItemNo !== null) {
            const parent = await ctx.db
                .query("backupItems")
                .withIndex("by_number", (q) =>
                    q.eq("serverId", serverId).eq("planId", plan._id).eq("itemNo", item.dependencyItemNo!),
                )
                .unique()
            if (!parent || !["created", "skipped", "updated"].includes(parent.state) || !parent.mappedId)
                return block(ctx, plan, item, "Its category was not created or confirmed")
        }
        if (item.state === "planned") {
            if (op.type !== "reserve") fail(409, "Reserve native item before claim")
            const prior = await backupOriginRow(ctx, serverId, plan.provider, item.sourceId)
            const originFields = {
                serverId,
                provider: plan.provider,
                category: "structure" as const,
                family: "structure",
                sourceId: item.sourceId,
                state: "reserved" as const,
                planId: plan._id,
                itemNo: item.itemNo,
                generation: 1 as const,
                mappedId: prior?.mappedId ?? null,
                desiredHash: item.desiredHash,
            }
            let originId
            // An earlier restore's channel that was deleted since is created again, and its origin points at the new channel from here on
            if (prior) {
                originId = prior._id
                await ctx.db.patch(prior._id, { ...originFields, noDispatch: undefined, resolved: undefined })
            } else {
                await backupOriginCapacity(ctx, serverId, plan.provider)
                originId = await ctx.db.insert("backupOrigins", originFields)
            }
            const dispatchExpiresAt = Math.min(plan.expiresAt, now + BACKUP_DISPATCH_MS)
            await ctx.db.patch(item._id, {
                state: "reserved",
                originId,
                desiredChannel: channel,
                dispatchExpiresAt,
                botId: context.botId,
            })
            await ctx.db.patch(plan._id, { cleanupAt: undefined })
            const reserved = (await ctx.db.get(item._id))!
            return {
                type: "grant",
                item: publicBackupItem(plan, reserved),
                grant: backupGrant(plan, reserved),
                claimed: false,
            }
        }
        if (op.type === "reserve")
            return { type: "grant", item: publicBackupItem(plan, item), grant: backupGrant(plan, item), claimed: false }
        if (
            item.state !== "reserved" ||
            !item.originId ||
            now >= item.dispatchExpiresAt! ||
            item.botId !== context.botId ||
            canonicalBackupJson(channel) !== canonicalBackupJson(item.desiredChannel)
        )
            fail(409, "Native reservation changed or expired")
        const token = claimToken(op.claimToken),
            origin = await ctx.db.get(item.originId)
        if (!origin || origin.state !== "reserved" || origin.planId !== plan._id || origin.itemNo !== item.itemNo)
            fail(409, "Origin reservation changed")
        await ctx.db.patch(item._id, { state: "claimed", claimedAt: now, claimToken: token })
        await ctx.db.patch(origin._id, { state: "claimed" })
        const claimed = (await ctx.db.get(item._id))!
        return {
            type: "grant",
            item: publicBackupItem(plan, claimed),
            grant: backupGrant(plan, claimed),
            claimed: true,
        }
    },
})

// The latest restore plan of each server. A preview makes the same plan a chat restore would run, on fresh native evidence, and keeps only the
// latest unconfirmed plan
const previewRow = (ctx: Pick<QueryCtx, "db">, serverId: string) =>
    ctx.db
        .query("backupPreviewJobs")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const preview = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupPreviewResult> => {
        const input = decode(BackupPreviewRequest, request),
            serverId = server(input.serverId),
            context = backupContext(input.context)
        await backupOwner(ctx, serverId, context)
        const manifest = backupManifest(input.manifest),
            proof = native(input.native, serverId, context),
            { channelId } = input.archive
        if (channelId !== context.dmChannelId) fail(403, "The archive must be in the owner's private DM")
        backupRestorable(manifest, serverId, context)
        const row = await previewRow(ctx, serverId),
            old = row ? await ctx.db.get(row.planId) : null
        // A newer check replaces the plan that was never confirmed. A confirmed plan stays until it expires
        if (old && old.confirmedAt === undefined) await backupDeletePlan(ctx, old)
        const plan = await createBackupPlan(ctx, serverId, context, manifest, input.archiveDigest, proof, input.match)
        if (row) await ctx.db.patch(row._id, { planId: plan._id })
        else await ctx.db.insert("backupPreviewJobs", { serverId, planId: plan._id })
        return { plan: publicBackupPlan(plan) }
    },
})
