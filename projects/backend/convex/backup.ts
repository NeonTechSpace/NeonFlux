import { v } from "convex/values"
import {
    BACKUP_RESTORE_LIMITS,
    BACKUP_RUN_IDLE_MS,
    BackupManageRequest,
    BackupPreviewFailedRequest,
    BackupPreviewReadyRequest,
    BackupPreviewSegmentRequest,
    BackupPreviewStartRequest,
    BackupQueryRequest,
    BackupRunStepRequest,
    BackupOutcomeClaimRequest,
    BackupSnapshotPageRequest,
    BackupWorkRequest,
    backupConfigFamilies,
    backupGain,
    type BackupCategory,
    type BackupChange,
    type BackupConfigObject,
    type BackupContext,
    type BackupItem,
    type BackupManageResult,
    type BackupNativeProof,
    type BackupPreviewFailure,
    type BackupPreviewFailedResult,
    type BackupPreviewReadyResult,
    type BackupPreviewResult,
    type BackupQueryResult,
    type BackupRunStepResult,
    type BackupOutcomeClaimResult,
    type BackupSegment,
    type BackupSnapshotPage,
    type BackupStructureObject,
    type BackupWorkResult,
    type BackupXpPage,
} from "@neonflux/contracts/backup"
import { STRUCTURE_CHANNELS } from "@neonflux/contracts/common"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { places } from "@neonflux/contracts/structure"
import type { DashboardBackupItems, DashboardBackupRestore } from "../dashboard-contracts.js"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import {
    internalMutation,
    mutation,
    query as dashboardQuery,
    type MutationCtx,
    type QueryCtx,
} from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { Doc, Id } from "./_generated/dataModel.js"
import { recordAudit } from "./auditLog.ts"
import { dashboardSession } from "./dashboard.ts"
import { overwriteText } from "@neonflux/contracts/permission-names"
import { ringWork } from "./workSignal.ts"
import {
    BACKUP_DISPATCH_MS,
    BACKUP_PLAN_MS,
    BACKUP_RETENTION,
    BACKUP_SETTLE_MS,
    backupChannelSemantic,
    backupContext,
    backupDiff,
    backupConfigRule,
    backupHash,
    backupHeader,
    backupNativeProof,
    backupNormalized,
    backupOrderMoves,
    backupStructure,
    backupSwitchPath,
    backupTarget,
    canonicalBackupJson,
} from "./backupDomain.ts"
import { backupConfigRows, backupFamilyRows, backupPagedFamily, backupSnapshotPage } from "./backupProjections.ts"
import { backupCapacityKey, backupImports, backupTakesPlace } from "./backupImports.ts"
import { backupAgeItem } from "./backupRetention.ts"
import { backupWriteConfig, backupWriteXp } from "./backupWrites.ts"
import { memberDataDeletedSince } from "./memberData.ts"
import { publicRolePanel } from "./rolesStore.ts"
import {
    type BackupRead,
    backupConfigMappingsCurrent,
    backupExtraDecision,
    backupGrant,
    backupItemRow,
    backupMappedConfig,
    backupNativeDecision,
    backupOrderPositions,
    backupOriginRow,
    backupOwner,
    backupPaused,
    backupPlanOwner,
    backupPlanRow,
    backupPlanUnresolved,
    BACKUP_IDENTICAL_RANK,
    backupProtected,
    backupRestorableTypes,
    backupRank,
    backupRewriteConfig,
    backupSetItem,
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
    backupAutomodPatterns,
    backupCleanupExclusions,
    backupConfigurationCapacity,
    backupConfigReferences,
    backupCurrentConfig,
    backupCurrentXp,
    backupDependencyRefusal,
    backupDestinationRefusal,
    backupFamilyRefusal,
    backupRetainedPolicies,
    backupValidateConfigReferences,
    backupWarning,
} = backupImports
function native(value: BackupNativeProof | null, serverId: string, context: BackupContext) {
    return value === null ? null : backupNativeProof(value, serverId, context)
}
/** The item states that are not yet an outcome the owner can rely on */
const backupUnsettled = ["planned", "reserved", "claimed", "uncertain"] as const
const terminal = (item: Doc<"backupItems">) =>
    ["created", "updated", "deleted", "skipped", "conflict", "blocked", "failed", "uncertain"].includes(item.state)
// A restore skips the data of members who deleted theirs after the backup read it, and counts them without naming them
const backupDeletedMembers = (count: number, tense: "is" | "was") =>
    `${count} ${count === 1 ? `member ${tense}` : `members ${tense === "is" ? "are" : "were"}`} left out, since they deleted their data with !mydata after the backup was made`
/** One page of the snapshot an export reads. Each page checks the owner again, as each request of the export does */
export const snapshotPage = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupSnapshotPage> => {
        const input = decode(BackupSnapshotPageRequest, request),
            serverId = server(input.serverId),
            context = backupContext(input.context)
        await backupOwner(ctx, serverId, context)
        return backupSnapshotPage(ctx, serverId, input.selected, input.cursor)
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
            if (op.provider !== context.provider) fail(403, "Provider mismatch")
            const origins = []
            for (const sourceId of new Set(op.sourceIds)) {
                const row = await backupOriginRow(ctx, serverId, op.provider, sourceId)
                if (row) origins.push(publicBackupOrigin(row))
            }
            return { type: "origins", origins }
        }
        if (op.type === "item") {
            const { plan, item } = await backupItemRow(ctx, serverId, op.binding)
            backupPlanOwner(plan, context)
            // Turning the cleanup module on resumes the policies that are on, so the bot's proof reads their channels too
            const resumed =
                item.family === "cleanup"
                    ? (await backupRetainedPolicies(ctx, serverId)).map((x) => x.channelId)
                    : undefined
            return {
                type: "item",
                item: publicBackupItem(plan, item),
                object: (item.object as BackupConfigObject | BackupXpPage | BackupStructureObject | undefined) ?? null,
                ...(resumed?.length ? { resumed } : {}),
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
        const byState = (state: Doc<"backupItems">["state"]) =>
            ctx.db
                .query("backupItems")
                .withIndex("by_plan_state", (q) => q.eq("planId", plan._id).eq("state", state))
                .take(BACKUP_RESTORE_LIMITS.page)
        // The next items to run, in item order: one waiting for its claim comes before those still planned
        if (op.type === "open") {
            const rows = [...(await byState("reserved")), ...(await byState("planned"))]
                .sort((a, b) => a.itemNo - b.itemNo)
                .slice(0, BACKUP_RESTORE_LIMITS.page)
            return { type: "open", items: rows.map((x) => publicBackupItem(plan, x)) }
        }
        // A channel creation is confirmed by a check unless its outcome is known
        if (op.type === "unconfirmed") {
            const rows = []
            for (const state of ["claimed", "uncertain", "failed"] as const)
                for (const x of await ctx.db
                    .query("backupItems")
                    .withIndex("by_plan_category_state", (q) =>
                        q.eq("planId", plan._id).eq("category", "structure").eq("state", state),
                    )
                    .filter((q) => q.and(q.eq(q.field("disposition"), "create"), q.neq(q.field("resolution"), "match")))
                    .take(BACKUP_RESTORE_LIMITS.page))
                    if (x.mappedId) rows.push(x)
            return {
                type: "unconfirmed",
                items: rows
                    .sort((a, b) => a.itemNo - b.itemNo)
                    .slice(0, BACKUP_RESTORE_LIMITS.page)
                    .map((x) => publicBackupItem(plan, x)),
            }
        }
        const rows = await ctx.db
            .query("backupItems")
            .withIndex(op.type === "page" ? "by_plan_rank" : "by_plan", (q) => q.eq("planId", plan._id))
            .paginate({
                cursor: op.cursor ?? null,
                numItems: op.type === "page" ? BACKUP_RESTORE_LIMITS.chatPage : BACKUP_RESTORE_LIMITS.page,
            })
        return {
            type: op.type,
            items: rows.page.map((x) => publicBackupItem(plan, x)),
            ...(!rows.isDone ? { nextCursor: rows.continueCursor } : {}),
        }
    },
})

type PlannedItem = Omit<Doc<"backupItems">, "_id" | "_creationTime" | "planId">
type DraftItem = Omit<PlannedItem, "rank" | "itemNo" | "generation" | "state" | "serverId">
/** An item before it has its number: group is its place in the run, and parentId the archive category it sits in */
type Draft = { group: number; parentId: string | null; item: DraftItem; changes: BackupChange[]; bits: bigint }
/** An item with what it changes, which the plan stores beside it */
type Prepared = { item: PlannedItem; changes: BackupChange[] }
type FieldChange = Extract<BackupChange, { kind: "field" }>
type Json = Exclude<FieldChange["before"], undefined>
/** The most a stored list of one item's changes may hold. A larger item is blocked instead of shown in part */
const BACKUP_CHANGES_BYTES = 524288
const noPermissions = { allow: "0", deny: "0" }
/** The leaf rows of what changes between two values. A setting that turns on is marked */
const fieldChanges = (before: unknown, after: unknown, family?: string): FieldChange[] =>
    backupDiff(before, after).map((row) => ({
        kind: "field",
        path: row.path,
        ...("before" in row ? { before: row.before as Json } : {}),
        ...("after" in row ? { after: row.after as Json } : {}),
        ...(backupSwitchPath(row.path, family) && row.after === true && row.before !== true
            ? { on: true as const }
            : {}),
    }))
/** The names of the top-level settings that changed, at most ten. A changed overwrite is named permissions */
const changedNames = (changes: BackupChange[]) =>
    [...new Set(changes.map((x) => (x.kind === "field" ? x.path.split(/[.[]/)[0]! : "permissions")))]
        .filter((name) => name !== "linkChannels")
        .slice(0, 10)
const perms = (o?: { allow: string; deny: string }) => (o ? { allow: o.allow, deny: o.deny } : noPermissions)
const channelFields = (channel: BackupStructureObject) => {
    const {
        overwrites: _overwrites,
        sourceId: _id,
        capturedAt: _at,
        managed: _managed,
        position: _position,
        ...fields
    } = channel
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
/** The plan's items of one category so far, or of one archive ID, read through by_plan_source */
const planItems = (ctx: BackupRead, planId: Id<"backupPlans">, category: BackupCategory, sourceId?: string) =>
    ctx.db
        .query("backupItems")
        .withIndex("by_plan_source", (q) =>
            sourceId === undefined
                ? q.eq("planId", planId).eq("category", category)
                : q.eq("planId", planId).eq("category", category).eq("sourceId", sourceId),
        )
/** Every channel item so far: archive channels, deletions and the order item. An archive holds at most 500 channels, and so does a server */
const channelItems = (ctx: BackupRead, planId: Id<"backupPlans">) =>
    planItems(ctx, planId, "structure").take(STRUCTURE_CHANNELS * 2 + 2)
/** The kinds of segment in the order a plan takes them */
const segmentPhase: Record<BackupSegment["kind"], number> = {
    categories: 0,
    channels: 1,
    structure: 2,
    config: 3,
    xp: 4,
}
/** Configuration names a forum, media or announcement channel as a message channel, such as a suggestion forum */
const pendingType = (object: BackupStructureObject) =>
    object.type === "forum" || object.type === "media" || object.type === "announcement" ? "text" : object.type
/**
 * What a restore check does with one segment of an archive against the server as the segment's fresh native evidence shows it, with what each
 * item changes, numbered after the plan's earlier items. Previews and plans are the same thing, so there is one decision. It only reads, and
 * the segments before it are read through by_plan_source. Channels run in this order: category creates, category updates, channel creates,
 * channel updates, channel deletes and category deletes, then the order item. Creates run before deletes, so a full server fails safely
 * instead of after destruction, and a category changes before its channels
 */
async function backupPlanSegment(
    ctx: MutationCtx,
    plan: Doc<"backupPlans">,
    segmentNo: number,
    segment: BackupSegment,
    proof: BackupNativeProof | null,
) {
    const serverId = plan.serverId,
        header = plan.header!,
        counts = { create: 0, update: 0, delete: 0, skip: 0, blocked: 0 },
        prepared: Prepared[] = [],
        gain = { items: 0, bits: 0n, switches: 0 },
        turnsOn: NonNullable<Doc<"backupPlans">["turnsOn"]> = []
    let warned = 0
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
            itemNo: plan.itemCount + prepared.length + 1,
            generation: 1,
            state: "planned",
            ...(named.length ? { changed: named } : {}),
            ...(granted ? { gain: true as const } : {}),
            ...(on ? { on: true as const } : {}),
            rank: 0,
        }
        row.rank = backupRank(row)
        counts[row.disposition]++
        if (granted) {
            gain.items++
            gain.bits |= bits
        }
        gain.switches += on
        // A delete has its own line, so only the items that start other work count as warned
        if (row.warning && row.disposition !== "delete") warned++
        if (row.on)
            turnsOn.push({
                category: row.category,
                family: row.family,
                sourceId: row.sourceId,
                ...(row.name !== undefined ? { name: row.name } : {}),
            })
        prepared.push({ item: row, changes: shown })
    }
    const phase = segmentPhase[segment.kind]
    if (phase < (plan.phase ?? 0)) fail(400, "Restore segments out of order")
    const received = { ...(plan.received ?? { config: 0, xp: 0, structure: 0 }) }
    const familyCreates = { ...plan.familyCreates }
    let automodPatterns = plan.automodPatterns ?? 0
    let xpAfter = plan.xpAfter
    if (segment.kind === "categories" || segment.kind === "channels") {
        if (!header.selected.includes("structure")) fail(400, "The archive holds no channels")
        const earlier = await channelItems(ctx, plan._id),
            seen = new Set(earlier.map((x) => x.sourceId))
        for (const object of segment.structure) {
            const o = header.observations
            if (
                seen.has(object.sourceId) ||
                (segment.kind === "categories") !== (object.type === "category") ||
                object.capturedAt < o.structureStartedAt! ||
                object.capturedAt > o.structureFinishedAt!
            )
                fail(400, "Invalid restore segment")
            seen.add(object.sourceId)
        }
        received.structure += segment.structure.length
        // A category's decision reads the channels that follow it, which come in later segments, so the categories carry their summaries
        const view = await backupStructureView(
                ctx,
                plan,
                segment.kind === "categories" ? [...segment.structure, ...segment.channels] : segment.structure,
                plan.match,
                earlier.filter((x) => x.disposition === "create").map((x) => x.sourceId),
            ),
            cascaded = new Set(earlier.flatMap((x) => x.cascaded ?? []))
        const drafts: Draft[] = []
        for (const object of [...segment.structure].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
            const decision = await backupNativeDecision(ctx, plan, object, proof, view),
                { disposition, observed, desired } = decision
            if (disposition === "create" && object.type === "category") view.pending.add(object.sourceId)
            const brings =
                disposition === "create"
                    ? channelDiff(undefined, desired!, decision.dropped)
                    : disposition === "update"
                      ? channelDiff(observed, desired!, decision.dropped, decision.follows)
                      : { changes: disposition === "skip" ? droppedChanges(decision.dropped ?? []) : [], gain: 0n }
            drafts.push({
                group: Number(disposition !== "create"),
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
                    ...(decision.cascaded?.length ? { cascaded: decision.cascaded } : {}),
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
        // A channel that is created or moved into a category waits for it, and a category that is created is needed before anything moves into it
        drafts.sort((a, b) => a.group - b.group)
        const numbers = new Map([
            ...earlier.map((x) => [x.sourceId, { itemNo: x.itemNo, disposition: x.disposition }] as const),
            ...drafts.map(
                (d, i) =>
                    [d.item.sourceId, { itemNo: plan.itemCount + i + 1, disposition: d.item.disposition }] as const,
            ),
        ])
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
    } else if (segment.kind === "structure") {
        if (!header.selected.includes("structure") || (plan.phase ?? 0) >= segmentPhase.structure)
            fail(400, "Invalid restore segment")
        const earlier = await channelItems(ctx, plan._id),
            archived = earlier.flatMap((x) => (x.object ? [backupStructure(x.object)] : [])),
            view = await backupStructureView(ctx, plan, archived, plan.match),
            drafts: Draft[] = []
        if (plan.match && proof) {
            // The channels this plan moves out of their category leave it
            const leaving = new Set(
                earlier.flatMap((x) =>
                    x.disposition === "update" && x.changed?.includes("parentId") && x.mappedId ? [x.mappedId] : [],
                ),
            )
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
                    group: extra.type === "category" ? 1 : 0,
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
                        // Only what the listing shows of it, which names the channel for the claim. The archive's time keeps a check of
                        // the same archive the same plan
                        object: backupStructure({
                            sourceId: extra.id,
                            type: extra.type as BackupStructureObject["type"],
                            name: extra.name,
                            parentId: extra.parentId,
                            overwrites: [],
                            capturedAt: header.capturedAt,
                        }),
                    },
                    changes: [],
                    bits: 0n,
                })
            }
        }
        // One order item after every other channel item puts the channels in the archive's order. It is decided again when it runs, once
        // the channels the plan creates exist, so it comes whenever the order differs now or the plan creates a channel
        if (proof && archived.some((o) => o.position !== undefined)) {
            const positions = await backupOrderPositions(ctx, serverId, proof, view.live),
                moves = backupOrderMoves(proof.channels, positions),
                names = new Map(proof.channels.map((c) => [c.id, c.name])),
                after = (id: string | null) => (id === null ? "first" : `after ${names.get(id) ?? id}`),
                from = places(proof.channels)
            if (moves.length || earlier.some((x) => x.disposition === "create"))
                drafts.push({
                    group: 2,
                    parentId: null,
                    item: {
                        category: "structure",
                        family: "structure",
                        sourceId: "order",
                        disposition: "update",
                        reason: null,
                        mappedId: null,
                        name: "Channel order",
                        order: true,
                        expectedHash: await backupHash(proof.channels.map((c) => [c.id, c.parentId])),
                        desiredHash: await backupHash([...positions]),
                        dependencyItemNo: null,
                    },
                    changes: moves.map((move) => ({
                        kind: "field",
                        path: `order.${names.get(move.id) ?? move.id}`,
                        before: after(from.get(move.id)?.afterId ?? null),
                        after: after(move.precedingSiblingId),
                    })),
                    bits: 0n,
                })
        }
        drafts.sort((a, b) => a.group - b.group)
        for (const draft of drafts) add(draft.item, draft.changes, draft.bits)
    } else if (segment.kind === "config") {
        if (!header.selected.includes("config")) fail(400, "The archive holds no settings")
        received.config += segment.config.length
        const channels = await channelItems(ctx, plan._id),
            created = new Map(
                channels.flatMap((x) =>
                    x.disposition === "create" && x.object
                        ? [[x.sourceId, { itemNo: x.itemNo, type: pendingType(backupStructure(x.object)) }] as const]
                        : [],
                ),
            ),
            pendingChannels = new Map([...created].map(([id, x]) => [id, x.type]))
        // The settings an earlier segment writes that this one names, such as the voice generator of looking for group
        const earlierConfig = async (object: BackupConfigObject) => {
            const ids =
                object.family === "lfg" && object.value.generatorChannelId
                    ? [object.value.generatorChannelId]
                    : object.family === "onboarding"
                      ? [
                            ...object.value.steps.flatMap((step) => (step.type === "panel" ? [step.name] : [])),
                            "rolepicker",
                        ]
                      : []
            const found: BackupConfigObject[] = []
            for (const id of ids)
                for (const row of await planItems(ctx, plan._id, "config", id).take(backupConfigFamilies.length))
                    if (row.object && (row.disposition === "create" || row.disposition === "update"))
                        found.push(row.object as BackupConfigObject)
            return found
        }
        // The settings of this segment that take a place of their feature, for the capacity of the next ones
        const placed: BackupConfigObject[] = []
        // Each family is read once, since every setting of a large family would otherwise read all of its rows again
        const rowsOf = new Map<BackupConfigObject["family"], Awaited<ReturnType<typeof backupConfigRows>>>()
        for (const object of [...segment.config].sort(
            (a, b) =>
                backupConfigFamilies.indexOf(a.family) - backupConfigFamilies.indexOf(b.family) ||
                a.sourceId.localeCompare(b.sourceId),
        )) {
            backupConfigRule(object)
            if (
                (await planItems(ctx, plan._id, "config", object.sourceId).take(backupConfigFamilies.length)).some(
                    (x) => x.family === object.family,
                )
            )
                fail(400, "Invalid restore segment")
            if (!backupPagedFamily(object.family) && !rowsOf.has(object.family))
                rowsOf.set(object.family, await backupConfigRows(ctx, serverId, object.family))
            const rows = backupPagedFamily(object.family)
                ? await backupFamilyRows(ctx, serverId, object)
                : rowsOf.get(object.family)!
            const configMappings: NonNullable<Doc<"backupItems">["configMappings"]> = []
            for (const sourceId of new Set(
                backupConfigReferences(object)
                    .filter((x) => x.type === "text" || x.type === "category" || x.type === "voice")
                    .map((x) => x.id),
            )) {
                const origin = await backupOriginRow(ctx, serverId, plan.provider, sourceId),
                    pending = created.get(sourceId)
                configMappings.push({
                    sourceId,
                    targetId: pending ? null : (origin?.mappedId ?? sourceId),
                    targetItemNo: pending?.itemNo ?? null,
                })
            }
            const mapped = await backupMappedConfig(ctx, plan, object, pendingChannels),
                effective = mapped ?? object
            // A setting named by a channel the plan creates is new, since the channel does not exist yet
            const pendingTarget =
                (object.family === "cleanupPolicy" ||
                    object.family === "voiceGenerator" ||
                    object.family === "sticky") &&
                configMappings.some((x) => x.sourceId === object.value.channelId && x.targetId === null)
            const current = pendingTarget
                    ? { row: null, value: null, hash: await backupHash(null) }
                    : await backupCurrentConfig(ctx, serverId, effective, rows),
                target = backupTarget(effective, current.value),
                identical =
                    current.value &&
                    !configMappings.some((x) => x.targetId === null) &&
                    canonicalBackupJson(backupNormalized(current.value)) ===
                        canonicalBackupJson(backupNormalized(target))
            const retained = object.family === "cleanup" ? await backupRetainedPolicies(ctx, serverId) : []
            const writes = prepared.flatMap((x) =>
                x.item.category === "config" && (x.item.disposition === "create" || x.item.disposition === "update")
                    ? [x.item.object as BackupConfigObject]
                    : [],
            )
            const refused = !mapped
                ? "It uses a channel from an earlier restore that NeonFlux could not confirm"
                : identical
                  ? null
                  : (backupFamilyRefusal(effective, current.value, current.row) ??
                    (await backupValidateConfigReferences(ctx, serverId, effective, proof, pendingChannels)) ??
                    (await backupDependencyRefusal(ctx, serverId, effective, [
                        ...writes,
                        ...(await earlierConfig(object)),
                    ])) ??
                    backupDestinationRefusal(target, current.value, proof, pendingChannels, retained) ??
                    backupAutomodPatterns(effective, writes, rows, plan.automodPatterns ?? 0) ??
                    backupCleanupExclusions(effective, writes, rows) ??
                    (!backupTakesPlace(effective, current.row)
                        ? null
                        : await backupConfigurationCapacity(
                              ctx,
                              serverId,
                              effective,
                              placed,
                              rows,
                              // The places earlier segments take. This segment's are the placed ones above
                              plan.familyCreates?.[backupCapacityKey(effective)] ?? 0,
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
                    ? backupWarning(target, current.value, retained, effective, current.row)
                    : undefined
            if ((disposition === "create" || disposition === "update") && backupTakesPlace(effective, current.row)) {
                const key = backupCapacityKey(effective)
                familyCreates[key] = (familyCreates[key] ?? 0) + 1
                placed.push(effective)
            }
            // A later segment checks the server's automod patterns as this segment's writes leave them, as its steps will find them
            if ((disposition === "create" || disposition === "update") && effective.family === "automod")
                automodPatterns +=
                    effective.value.patterns.length -
                    (current.value?.family === "automod" ? current.value.value.patterns.length : 0)
            add(
                {
                    category: "config",
                    family: object.family,
                    sourceId: object.sourceId,
                    disposition,
                    reason: refused,
                    ...(warning ? { warning } : {}),
                    expectedHash: current.hash,
                    desiredHash: await backupHash(target),
                    dependencyItemNo: null,
                    mappedId: null,
                    object,
                    configMappings,
                },
                disposition === "create" || disposition === "update"
                    ? fieldChanges(
                          current.value && backupNormalized(current.value).value,
                          backupNormalized(target).value,
                          object.family,
                      )
                    : [],
            )
        }
    } else {
        if (!header.selected.includes("xp")) fail(400, "The archive holds no XP")
        // Pages come in member order, so no member is in two of them
        const ids = segment.xp.map((x) => x.userId)
        if (ids.some((id, i) => (i === 0 ? xpAfter !== undefined && id <= xpAfter : id <= ids[i - 1]!)))
            fail(400, "Invalid restore segment")
        xpAfter = ids.at(-1)
        received.xp += segment.xp.length
        const leveling = await ctx.db
                .query("levelingSettings")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .unique(),
            epoch = (leveling?.config ?? defaultLevelingSettings()).scoreEpoch
        const members: BackupXpPage["members"] = [],
            changes: BackupChange[] = []
        let deleted = 0,
            creates = 0,
            updates = 0
        for (const object of segment.xp) {
            // A member who deleted their data after the backup read it keeps it deleted
            if (await memberDataDeletedSince(ctx, serverId, object.userId, header.observations.databaseAt!)) {
                deleted++
                continue
            }
            const current = await backupCurrentXp(ctx, serverId, object)
            if (!current.row) creates++
            else if (current.xp !== object.xp) updates++
            members.push({ userId: object.userId, xp: object.xp, expected: current.row ? current.xp : null })
            if (!current.row || current.xp !== object.xp)
                changes.push({
                    kind: "field",
                    path: `xp.${object.userId}`,
                    ...(current.row ? { before: current.xp } : {}),
                    after: object.xp,
                })
        }
        const reason = deleted ? backupDeletedMembers(deleted, "is") : null
        if (members.length)
            add(
                {
                    category: "xp",
                    family: "xp",
                    sourceId: `xp-${segmentNo}`,
                    name: `${members.length} ${members.length === 1 ? "member" : "members"}, from <@${members[0]!.userId}> to <@${members.at(-1)!.userId}>`,
                    disposition: updates ? "update" : creates ? "create" : "skip",
                    reason,
                    expectedHash: await backupHash(members.map((x) => [x.userId, x.expected])),
                    desiredHash: await backupHash(members.map((x) => [x.userId, x.xp])),
                    dependencyItemNo: null,
                    mappedId: null,
                    object: { sourceId: `xp-${segmentNo}`, epoch, members },
                },
                changes,
            )
        else if (reason)
            add(
                {
                    category: "xp",
                    family: "xp",
                    sourceId: `xp-${segmentNo}`,
                    name: `${deleted} ${deleted === 1 ? "member" : "members"}`,
                    disposition: "blocked",
                    reason,
                    expectedHash: await backupHash(null),
                    desiredHash: await backupHash(null),
                    dependencyItemNo: null,
                    mappedId: null,
                },
                [],
            )
    }
    return {
        prepared,
        counts,
        gain: { ...gain, bits: gain.bits.toString() },
        warned,
        turnsOn,
        progress: { phase, received, familyCreates, automodPatterns, xpAfter },
    }
}
/** The plans of a server that are not finished: building, or waiting to be confirmed, or confirmed with a run that did not settle */
async function unfinishedPlans(ctx: BackupRead, serverId: string, now: number) {
    return (
        await ctx.db
            .query("backupPlans")
            .withIndex("by_server_live", (q) => q.eq("serverId", serverId).eq("settledAt", undefined))
            .take(BACKUP_RESTORE_LIMITS.plans * 10)
    ).filter(
        (plan) =>
            !plan.forgotten &&
            (plan.state === "building"
                ? plan.createdAt > now - BACKUP_RUN_IDLE_MS
                : plan.confirmedAt !== undefined || now < plan.expiresAt),
    )
}
/** A check that stopped coming in, which a new check or a website request may replace */
const staleBuilding = (plan: Doc<"backupPlans"> | null, now: number) =>
    plan?.state === "building" && plan.createdAt <= now - BACKUP_RUN_IDLE_MS
/** A plan nobody confirmed that a newer check replaces: forgotten now, and retention removes it in pages */
async function backupDropPlan(ctx: MutationCtx, plan: Doc<"backupPlans">, now: number) {
    if (plan.confirmedAt === undefined && !plan.forgotten)
        await ctx.db.patch(plan._id, { forgotten: true, cleanupAt: now })
}
/** Stores one segment's items and what they change, and moves the plan's totals */
async function storeSegment(
    ctx: MutationCtx,
    plan: Doc<"backupPlans">,
    decided: Awaited<ReturnType<typeof backupPlanSegment>>,
) {
    for (const { item, changes } of decided.prepared) {
        await ctx.db.insert("backupItems", { ...item, planId: plan._id })
        if (changes.length)
            await ctx.db.insert("backupChanges", {
                serverId: plan.serverId,
                planId: plan._id,
                itemNo: item.itemNo,
                changes,
            })
    }
    const counts = { ...plan.counts }
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] += decided.counts[key]
    const stateCounts = { ...plan.stateCounts }
    stateCounts.planned = (stateCounts.planned ?? 0) + decided.prepared.length
    await ctx.db.patch(plan._id, {
        itemCount: plan.itemCount + decided.prepared.length,
        counts,
        gain: {
            items: plan.gain.items + decided.gain.items,
            bits: (BigInt(plan.gain.bits) | BigInt(decided.gain.bits)).toString(),
            switches: plan.gain.switches + decided.gain.switches,
        },
        stateCounts,
        warned: (plan.warned ?? 0) + decided.warned,
        turnsOn: [...(plan.turnsOn ?? []), ...decided.turnsOn],
        built: (plan.built ?? 0) + 1,
        segmentItems: [...(plan.segmentItems ?? []), await backupHash(decided.prepared.map((x) => x.item))],
        phase: decided.progress.phase,
        received: decided.progress.received,
        familyCreates: decided.progress.familyCreates,
        automodPatterns: decided.progress.automodPatterns,
        ...(decided.progress.xpAfter !== undefined ? { xpAfter: decided.progress.xpAfter } : {}),
    })
    return (await ctx.db.get(plan._id))!
}
/**
 * The last segment came in: the plan is ready and its hash binds every item. A check of the same archive that finds the same plan renews
 * the one it replaces, so an open page and the chat keep its ID and hash, and the new one is forgotten. Otherwise the replaced plan is
 */
async function finishPlan(ctx: MutationCtx, plan: Doc<"backupPlans">, now: number) {
    const header = plan.header!,
        received = plan.received!
    if (
        received.config !== header.counts.config ||
        received.xp !== header.counts.xp ||
        received.structure !== header.counts.structure ||
        (header.selected.includes("structure") && (plan.phase ?? 0) < segmentPhase.structure)
    )
        fail(400, "The restore segments do not hold the archive")
    const planHash = await backupHash({
        ownerId: plan.ownerId,
        provider: plan.provider,
        archiveDigest: plan.archiveDigest,
        manifestDigest: plan.manifestDigest,
        match: plan.match,
        segments: plan.segmentItems,
    })
    const old = plan.replaces ? await ctx.db.get(plan.replaces) : null,
        job = await previewRow(ctx, plan.serverId)
    if (
        old &&
        !old.forgotten &&
        old.confirmedAt === undefined &&
        old.planHash === planHash &&
        old.archiveDigest === plan.archiveDigest
    ) {
        await ctx.db.patch(old._id, {
            expiresAt: now + BACKUP_PLAN_MS,
            cleanupAt: now + BACKUP_PLAN_MS + BACKUP_RETENTION,
        })
        await ctx.db.patch(plan._id, { forgotten: true, cleanupAt: now })
        if (job?.planId === plan._id) await ctx.db.patch(job._id, { planId: old._id })
        return (await ctx.db.get(old._id))!
    }
    if (old) await backupDropPlan(ctx, old, now)
    await ctx.db.patch(plan._id, {
        state: "ready",
        planHash,
        createdAt: now,
        expiresAt: now + BACKUP_PLAN_MS,
        cleanupAt: now + BACKUP_PLAN_MS + BACKUP_RETENTION,
    })
    return (await ctx.db.get(plan._id))!
}

/**
 * Starts the run of a confirmed plan, or finds it running. The run goes on in the background until every item settled, and only a run that
 * makes no progress for 10 minutes ends without that. A run another plan holds is refused. notify asks the bot to post the outcome in the DM
 */
async function startRun(
    ctx: MutationCtx,
    plan: Doc<"backupPlans">,
    owner: { ownerId: string; channelId: string; messageId: string },
    now: number,
    notify: boolean,
): Promise<"started" | "running"> {
    const row = await previewRow(ctx, plan.serverId)
    if (holding(row, now, restoring)) {
        if (row!.planId === plan._id) return "running"
        fail(409, "A restore is running")
    }
    const fields = {
        state: "running" as const,
        planId: plan._id,
        createdAt: now,
        expiresAt: now + BACKUP_RUN_IDLE_MS,
    }
    if (row)
        await ctx.db.patch(row._id, {
            ...fields,
            failure: undefined,
            notify: notify ? true : undefined,
            outcomeDue: undefined,
        })
    else
        await ctx.db.insert("backupPreviewJobs", {
            serverId: plan.serverId,
            ownerId: owner.ownerId,
            channelId: owner.channelId,
            messageId: owner.messageId,
            match: plan.match,
            ...fields,
            ...(notify ? { notify: true as const } : {}),
        })
    await ctx.scheduler.runAt(now + BACKUP_RUN_IDLE_MS, internal.backup.previewExpire, { serverId: plan.serverId })
    await ringWork(ctx)
    return "started"
}
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupManageResult> => {
        const input = decode(BackupManageRequest, request),
            identity = source(input, Date.now()),
            context = backupContext(input.context),
            op = input.operation,
            serverId = identity.serverId,
            now = Date.now()
        await backupOwner(ctx, serverId, context)
        const plan = await backupPlanRow(ctx, serverId, op.binding)
        backupPlanOwner(plan, context)
        if (op.type === "confirm") {
            if (plan.state === "building") fail(409, "The check is still being built")
            // A check stays confirmable for a day, and a confirmed plan runs again until it is done or forgotten
            if (plan.forgotten || (plan.confirmedAt === undefined && now >= plan.expiresAt))
                fail(409, "Restore plan expired or forgotten")
            const duplicate = plan.confirmedAt !== undefined
            if (!duplicate) await ctx.db.patch(plan._id, { confirmedAt: now })
            const run = await startRun(
                ctx,
                plan,
                { ownerId: context.ownerId, channelId: context.dmChannelId, messageId: input.messageId },
                now,
                true,
            )
            return { type: "confirmed", duplicate, plan: publicBackupPlan((await ctx.db.get(plan._id))!), run }
        }
        if (await backupPlanUnresolved(ctx, plan._id)) fail(409, "Unresolved restore anchors retained")
        // A forgotten plan frees its place at once, and its items lose their archived objects in pages, the first one now
        await ctx.db.patch(plan._id, { forgotten: true })
        await forgetItems(ctx, plan._id, null)
        // A refresh or a restore from the website on this plan has nothing left to do, and a late answer to it is rejected
        const job = await previewRow(ctx, serverId)
        if (job?.planId === plan._id && (job.state === "queued" || job.state === "running" || job.state === "waiting"))
            await ctx.db.patch(job._id, { state: "done" })
        // Nor does an outcome it still owed
        if (job?.planId === plan._id && job.outcomeDue) await ctx.db.patch(job._id, { outcomeDue: undefined })
        await backupSetRetention(ctx, plan)
        return { type: "forgotten", plan: publicBackupPlan((await ctx.db.get(plan._id))!) }
    },
})
/**
 * Clears the archived objects and changes of one page of a forgotten plan's items, 200 at a time, and schedules the next page. An item still
 * planned is blocked, as it never runs
 */
async function forgetItems(ctx: MutationCtx, planId: Id<"backupPlans">, cursor: string | null) {
    const page = await ctx.db
        .query("backupItems")
        .withIndex("by_plan", (q) => q.eq("planId", planId))
        .paginate({ cursor, numItems: 200 })
    const now = Date.now()
    for (const item of page.page) {
        await backupSetItem(ctx, item, {
            object: undefined,
            desiredChannel: undefined,
            fromChannel: undefined,
            returnedChannel: undefined,
            ...(item.state === "planned"
                ? { state: "blocked", reason: "The restore plan was forgotten", finishedAt: now, noDispatch: true }
                : {}),
        })
        const changes = await ctx.db
            .query("backupChanges")
            .withIndex("by_number", (q) =>
                q.eq("serverId", item.serverId).eq("planId", planId).eq("itemNo", item.itemNo),
            )
            .unique()
        if (changes) await ctx.db.delete(changes._id)
    }
    if (!page.isDone)
        await ctx.scheduler.runAfter(0, internal.backup.forgetPage, { planId, cursor: page.continueCursor })
}
export const forgetPage = internalMutation({
    args: { planId: v.id("backupPlans"), cursor: v.union(v.string(), v.null()) },
    handler: (ctx, { planId, cursor }) => forgetItems(ctx, planId, cursor),
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
    await backupSetItem(ctx, item, { state, reason, finishedAt: Date.now(), noDispatch: true })
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
    await backupSetItem(ctx, item, {
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
    if (op.outcome === verb) await auditChannel(ctx, plan, item, verb === "updated" ? "Updated" : "Deleted")
    await backupSetRetention(ctx, plan)
    return updated(ctx, plan, item)
}
/** The changes the preview showed for a restored item, as the audit log keeps them in the entry's Details */
async function restoredChanges(ctx: MutationCtx, plan: Doc<"backupPlans">, item: Doc<"backupItems">) {
    const stored = await ctx.db
        .query("backupChanges")
        .withIndex("by_number", (q) => q.eq("serverId", plan.serverId).eq("planId", plan._id).eq("itemNo", item.itemNo))
        .unique()
    // An overwrite of a role or member that is gone is not restored, so it is no change. One that is restored reads as the restore check
    // shows it: the role or member it is for, and its permissions by name
    return (stored?.changes ?? []).flatMap((x) =>
        x.kind === "field"
            ? [{ path: x.path, before: x.before, after: x.after }]
            : x.dropped
              ? []
              : [
                    {
                        path: `permissions for ${x.type === "role" ? `<@&${x.id}>` : `<@${x.id}>`}`,
                        before: overwriteText(x.before),
                        after: overwriteText(x.after),
                    },
                ],
    )
}
/** Records a restored channel in the audit log, with the changes the preview showed as its details, as a restored setting has */
async function auditChannel(ctx: MutationCtx, plan: Doc<"backupPlans">, item: Doc<"backupItems">, verb: string) {
    const changes = await restoredChanges(ctx, plan, item)
    await recordAudit(
        ctx,
        plan.serverId,
        { userId: plan.ownerId, source: "command" },
        {
            kind: "setting",
            feature: "structure",
            setting: `restore channel ${item.name ?? item.sourceId}`,
            summary: `${verb} channel ${item.name ?? item.sourceId} from a backup`,
            ...(changes.length ? { changes } : {}),
        },
    )
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
        await backupSetItem(ctx, item, { state, finishedAt: now, noDispatch: true })
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
                    ? (await channelItems(ctx, plan._id)).flatMap((x) =>
                          !x.extra && x.object ? [backupStructure(x.object)] : [],
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
    await backupSetItem(ctx, item, {
        state: "claimed",
        claimedAt: now,
        claimToken: token,
        desiredChannel: desired,
        fromChannel: from,
        botId: context.botId,
        dispatchExpiresAt: now + BACKUP_DISPATCH_MS,
        mappedId: from.sourceId,
    })
    await ctx.db.patch(plan._id, { cleanupAt: undefined })
    const claimed = (await ctx.db.get(item._id))!
    return { type: "grant", item: publicBackupItem(plan, claimed), grant: backupGrant(plan, claimed), claimed: true }
}
/**
 * Claims the order item once every other channel item has run, so the channels it moves exist and sit in their categories. The moves are
 * decided on the fresh evidence, and none left to make settles it with no write
 */
async function claimOrder(
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
    const channels = (await channelItems(ctx, plan._id)).filter((x) => !x.order)
    if (channels.some((x) => x.state === "planned" || x.state === "reserved" || x.state === "claimed"))
        fail(409, "The channel items of this restore are still running")
    const view = await backupStructureView(
            ctx,
            plan,
            channels.flatMap((x) => (!x.extra && x.object ? [backupStructure(x.object)] : [])),
            plan.match,
        ),
        manageable = new Set(proof.channels.filter((c) => c.botCanManage).map((c) => c.id))
    // A channel NeonFlux cannot manage keeps its place, and the others move around it
    const moves = backupOrderMoves(
        proof.channels,
        await backupOrderPositions(ctx, plan.serverId, proof, view.live),
        (id) => !manageable.has(id),
    ).filter((move) => manageable.has(move.id))
    if (!moves.length) {
        await backupSetItem(ctx, item, { state: "skipped", finishedAt: now, noDispatch: true })
        return updated(ctx, plan, item)
    }
    await backupSetItem(ctx, item, {
        state: "claimed",
        claimedAt: now,
        claimToken: token,
        orderMoves: moves,
        botId: context.botId,
        dispatchExpiresAt: now + BACKUP_DISPATCH_MS,
    })
    const claimed = (await ctx.db.get(item._id))!
    return { type: "grant", item: publicBackupItem(plan, claimed), grant: backupGrant(plan, claimed), claimed: true }
}
/** The bot's answer to the order item it claimed. It moves no channel identity, so only the outcome is recorded */
async function orderOutcome(
    ctx: MutationCtx,
    plan: Doc<"backupPlans">,
    item: Doc<"backupItems">,
    op: Extract<BackupWorkRequest["operation"], { type: "outcome" }>,
    now: number,
) {
    if (item.state !== "claimed") {
        if (item.state === op.outcome) return updated(ctx, plan, item)
        fail(409, "Immutable restore outcome already recorded")
    }
    if (
        (op.outcome !== "updated" && op.outcome !== "failed" && op.outcome !== "uncertain") ||
        (op.noDispatch && op.outcome !== "failed") ||
        op.channel !== null ||
        op.mappedId !== null
    )
        fail(409, "Native response does not bind the claimed order")
    await backupSetItem(ctx, item, {
        state: op.outcome,
        finishedAt: now,
        ...(op.noDispatch ? { noDispatch: true } : {}),
        ...(op.outcome !== "updated"
            ? {
                  reason:
                      op.reason ??
                      (op.outcome === "failed"
                          ? "Fluxer did not apply this"
                          : "NeonFlux could not confirm whether this was applied"),
              }
            : {}),
    })
    if (op.outcome === "updated") {
        const changes = await restoredChanges(ctx, plan, item)
        await recordAudit(
            ctx,
            plan.serverId,
            { userId: plan.ownerId, source: "command" },
            {
                kind: "setting",
                feature: "structure",
                setting: "restore channel order",
                summary: `Moved ${item.orderMoves?.length ?? 0} channels to their order in a backup`,
                ...(changes.length ? { changes } : {}),
            },
        )
    }
    await backupSetRetention(ctx, plan)
    return updated(ctx, plan, item)
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
            if (item.order) return orderOutcome(ctx, plan, item, op, now)
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
                    await backupSetItem(ctx, item, { mappedId, ...(channel ? { returnedChannel: channel } : {}) })
                    await ctx.db.patch(origin._id, { mappedId })
                    return updated(ctx, plan, item)
                }
                fail(409, "Immutable restore outcome already recorded")
            }
            await backupSetItem(ctx, item, {
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
            if (op.outcome === "created") await auditChannel(ctx, plan, item, "Created")
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
            await backupSetItem(ctx, item, { resolution })
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
                await backupSetItem(ctx, item, {
                    state: "skipped",
                    ...(decision?.mappedId ? { mappedId: decision.mappedId } : {}),
                    finishedAt: now,
                    noDispatch: true,
                })
                return updated(ctx, plan, item)
            }
            const writes = item.disposition === "create" || item.disposition === "update"
            let write: { category: "xp"; page: BackupXpPage } | { category: "config"; object: BackupConfigObject }
            if (item.category === "xp") {
                const page = item.object as BackupXpPage,
                    leveling = await ctx.db
                        .query("levelingSettings")
                        .withIndex("by_server", (q) => q.eq("serverId", serverId))
                        .unique()
                // A new season changes what every member has, so the page conflicts instead of overwriting it
                if ((leveling?.config ?? defaultLevelingSettings()).scoreEpoch !== page.epoch)
                    return block(ctx, plan, item, "A new XP season started since the check", "conflict")
                write = { category: "xp", page }
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
                const rows = await backupFamilyRows(ctx, serverId, object),
                    current = await backupCurrentConfig(ctx, serverId, object, rows)
                if (current.hash !== item.expectedHash)
                    return block(
                        ctx,
                        plan,
                        item,
                        "The server's settings for this changed since the preview",
                        "conflict",
                    )
                if ((await backupHash(backupTarget(preview, current.value))) !== item.desiredHash)
                    return block(ctx, plan, item, "What it would restore changed since the preview", "conflict")
                if (writes) {
                    const denied =
                        backupFamilyRefusal(object, current.value, current.row) ??
                        (await backupValidateConfigReferences(ctx, serverId, object, proof)) ??
                        (await backupDependencyRefusal(ctx, serverId, object, [])) ??
                        backupDestinationRefusal(
                            backupTarget(object, current.value),
                            current.value,
                            proof,
                            undefined,
                            object.family === "cleanup" ? await backupRetainedPolicies(ctx, serverId) : [],
                        ) ??
                        // The server's rules already hold what earlier steps wrote, so this checks the feature's own total
                        backupAutomodPatterns(object, [], rows) ??
                        backupCleanupExclusions(object, [], rows) ??
                        (backupTakesPlace(object, current.row)
                            ? await backupConfigurationCapacity(ctx, serverId, object, [], rows)
                            : null)
                    if (denied) return block(ctx, plan, item, denied)
                }
                // What the preview showed it leaves, such as an event whose dates passed as a draft without a date
                write = { category: "config", object: backupTarget(object, current.value) }
            }
            if (!writes) {
                await backupSetItem(ctx, item, { state: "skipped", finishedAt: now, noDispatch: true })
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
            // A page sets each member whose XP is still what the check found, and leaves and counts each one whose XP changed since
            // or who deleted their data after the backup read it
            let left = 0,
                deleted = 0
            if (write.category === "xp")
                for (const member of write.page.members) {
                    if (
                        await memberDataDeletedSince(
                            ctx,
                            serverId,
                            member.userId,
                            plan.header!.observations.databaseAt!,
                        )
                    ) {
                        deleted++
                        continue
                    }
                    const object = { sourceId: member.userId, userId: member.userId, xp: member.xp },
                        current = await backupCurrentXp(ctx, serverId, object),
                        found = current.row ? current.xp : null
                    if (found !== member.expected) left++
                    else if (found !== member.xp) await backupWriteXp(writer, object)
                }
            // The feature's own rules ran at the plan and again just above, so what is left to refuse is a race. It undoes the whole step
            else {
                const stored = await ctx.db
                    .query("backupChanges")
                    .withIndex("by_number", (q) =>
                        q.eq("serverId", serverId).eq("planId", plan._id).eq("itemNo", item.itemNo),
                    )
                    .unique()
                await backupWriteConfig(
                    { ...writer, changes: (stored?.changes ?? []).flatMap((x) => (x.kind === "field" ? [x] : [])) },
                    write.object,
                )
            }
            await backupSetItem(ctx, item, {
                state: item.disposition === "create" ? "created" : "updated",
                finishedAt: now,
                noDispatch: true,
                ...(left || deleted
                    ? {
                          reason: [
                              ...(left
                                  ? [
                                        `${left} ${left === 1 ? "member was" : "members were"} left alone, since their XP changed after the check`,
                                    ]
                                  : []),
                              ...(deleted ? [backupDeletedMembers(deleted, "was")] : []),
                          ].join(". "),
                      }
                    : {}),
            })
            // A posted panel that changed under its message goes back to the bot, which clears the reactions whose role changed at once
            if (write.category === "config" && write.object.family === "panel") {
                const { name } = write.object.value,
                    panel = await ctx.db
                        .query("rolePanels")
                        .withIndex("by_server_name", (q) => q.eq("serverId", serverId).eq("name", name))
                        .unique()
                if (panel?.published?.pendingClear?.length)
                    return { type: "item", item: (await updated(ctx, plan, item)).item, panel: publicRolePanel(panel) }
            }
            return updated(ctx, plan, item)
        }
        if (item.category !== "structure" || item.disposition === "skip" || !proof)
            fail(400, "Native evidence required")
        if (item.order) {
            if (op.type !== "claim") fail(400, "The order item needs claim")
            return claimOrder(ctx, plan, item, context, proof, claimToken(op.claimToken), now)
        }
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
            } else originId = await ctx.db.insert("backupOrigins", originFields)
            const dispatchExpiresAt = now + BACKUP_DISPATCH_MS
            await backupSetItem(ctx, item, {
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
        await backupSetItem(ctx, item, { state: "claimed", claimedAt: now, claimToken: token })
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

// The restore job of each server. A preview makes the same plan a chat restore would run, on fresh native evidence, and keeps only the latest
// unconfirmed plan, with the DM message that carries its archive, so the owner can page it in chat and refresh it from the website. The
// owner confirms that plan on the website too, and the bot then runs it 20 items a pass
/** How long the bot has to answer a website refresh */
export const BACKUP_PREVIEW_MS = 60000
/** A new refresh waits this long after the previous one, so the refresh button cannot keep the bot reading Fluxer and the archive */
export const BACKUP_PREVIEW_INTERVAL_MS = 10000
/** The items the website lists at a time */
const BACKUP_VIEW_PAGE = 25
type Job = Doc<"backupPreviewJobs">
const previewRow = (ctx: Pick<QueryCtx, "db">, serverId: string) =>
    ctx.db
        .query("backupPreviewJobs")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
/** Whether a request, a restore or a wait for open claims still holds the job. An expired one is ended by previewExpire */
const holding = (row: Job | null, now: number, states: readonly Job["state"][]) =>
    !!row && states.includes(row.state) && row.expiresAt > now
const restoring = ["running", "waiting"] as const
/**
 * Starts a restore check of an archive. The plan is building until its segments came in, and it replaces the server's plan nobody confirmed
 * once it is ready. A confirmed plan stays, and a check is refused while a restore runs
 */
export const previewStart = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupPreviewResult> => {
        const input = decode(BackupPreviewStartRequest, request),
            serverId = server(input.serverId),
            context = backupContext(input.context)
        await backupOwner(ctx, serverId, context)
        const header = backupHeader(input.header),
            { channelId, messageId } = input.archive
        if (channelId !== context.dmChannelId) fail(403, "The archive must be in the owner's private DM")
        if (header.serverId !== serverId || header.provider !== context.provider)
            fail(403, "Same-server and same-provider restore required")
        const row = await previewRow(ctx, serverId),
            old = row?.planId ? await ctx.db.get(row.planId) : null,
            now = Date.now()
        // A confirmed plan is running, and a new check must not replace it
        if (holding(row, now, restoring)) fail(409, "A restore is running")
        // The answer to a website request counts only while that request is the latest. A check from chat is a newer request
        if (
            input.requestedAt !== undefined &&
            (!holding(row, now, ["queued"]) ||
                row!.createdAt !== input.requestedAt ||
                row!.ownerId !== context.ownerId ||
                row!.channelId !== channelId ||
                row!.messageId !== messageId)
        )
            fail(409, "That refresh was replaced")
        // The plan nobody confirmed is replaced by this check, so it does not count toward the server's plans
        const replaces = old && old.confirmedAt === undefined && !old.forgotten ? old : null
        if (
            (await unfinishedPlans(ctx, serverId, now)).filter((plan) => plan._id !== replaces?._id).length >=
            BACKUP_RESTORE_LIMITS.plans
        )
            fail(429, "Restore plan capacity reached")
        const manifestDigest = await backupHash({ header, segmentDigests: input.segmentDigests })
        const id = await ctx.db.insert("backupPlans", {
            serverId,
            ownerId: context.ownerId,
            provider: header.provider,
            backupId: header.backupId,
            archiveDigest: input.archiveDigest,
            manifestDigest,
            // The plan's hash binds its items once the last segment came in
            planHash: manifestDigest,
            revision: 1,
            createdAt: now,
            expiresAt: now + BACKUP_PLAN_MS,
            cleanupAt: now + BACKUP_PLAN_MS + BACKUP_RETENTION,
            itemCount: 0,
            counts: { create: 0, update: 0, delete: 0, skip: 0, blocked: 0 },
            gain: { items: 0, bits: "0", switches: 0 },
            match: input.match,
            forgotten: false,
            state: "building",
            segmentDigests: input.segmentDigests,
            built: 0,
            segmentItems: [],
            header,
            familyCreates: {},
            automodPatterns: 0,
            stateCounts: {},
            warned: 0,
            turnsOn: [],
            phase: 0,
            received: { config: 0, xp: 0, structure: 0 },
            ...(replaces ? { replaces: replaces._id } : {}),
        })
        const fields = {
            ownerId: context.ownerId,
            state: "done" as const,
            createdAt: input.requestedAt ?? now,
            expiresAt: now,
            channelId,
            messageId,
            planId: id,
            match: input.match,
        }
        if (row)
            await ctx.db.patch(row._id, { ...fields, failure: undefined, notify: undefined, outcomeDue: undefined })
        else await ctx.db.insert("backupPreviewJobs", { serverId, ...fields })
        const plan = (await ctx.db.get(id))!
        return { plan: publicBackupPlan(input.segmentDigests.length ? plan : await finishPlan(ctx, plan, now)) }
    },
})
/** One segment of a check, which must be the next one and match the digest previewStart took. The last one makes the plan ready */
export const previewSegment = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupPreviewResult> => {
        const input = decode(BackupPreviewSegmentRequest, request),
            serverId = server(input.serverId),
            context = backupContext(input.context)
        await backupOwner(ctx, serverId, context)
        const id = ctx.db.normalizeId("backupPlans", input.planId),
            plan = id ? await ctx.db.get(id) : null
        if (!plan || plan.serverId !== serverId) fail(404, "Restore plan not found")
        backupPlanOwner(plan, context)
        if (plan.state !== "building" || plan.forgotten) fail(409, "This check is not being built")
        if (input.segmentNo !== plan.built) fail(409, "Restore segment out of order")
        if ((await backupHash(input.segment)) !== plan.segmentDigests![input.segmentNo])
            fail(400, "The restore segment does not match its digest")
        if (new TextEncoder().encode(canonicalBackupJson(input.segment)).length > BACKUP_RESTORE_LIMITS.segmentBytes)
            fail(413, "Restore segment exceeds 512 KiB")
        const decided = await backupPlanSegment(
                ctx,
                plan,
                input.segmentNo,
                input.segment,
                native(input.native, serverId, context),
            ),
            stored = await storeSegment(ctx, plan, decided)
        return {
            plan: publicBackupPlan(
                stored.built === stored.segmentDigests!.length ? await finishPlan(ctx, stored, Date.now()) : stored,
            ),
        }
    },
})
/** What the bot does for the website now: read the archive again for a request, or run the next items of the plan the owner confirmed */
export const previewReady = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupPreviewReadyResult> => {
        const row = await previewRow(ctx, server(decode(BackupPreviewReadyRequest, request).serverId)),
            plan = (row?.state === "running" || row?.outcomeDue) && row.planId ? await ctx.db.get(row.planId) : null
        // A run from chat that ended for lack of progress still owes the owner its outcome
        const due = row?.outcomeDue && plan
        if (!row || (!due && (row.expiresAt <= Date.now() || (row.state !== "queued" && !(plan && !plan.forgotten)))))
            return { job: null }
        const { ownerId, channelId, messageId, match } = row
        return {
            job: {
                ownerId,
                channelId,
                messageId,
                requestedAt: row.createdAt,
                match,
                ...((row.state === "running" || due) && plan ? { plan: publicBackupPlan(plan) } : {}),
                ...(row.notify ? { notify: true as const } : {}),
                ...(due ? { ended: row.failure ? { failure: row.failure } : {} } : {}),
            },
        }
    },
})
/** Why the bot could not refresh a waiting preview. A sender who no longer owns the server loses the plan that was never confirmed */
export const previewFailed = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupPreviewFailedResult> => {
        const { serverId, requestedAt, failure } = decode(BackupPreviewFailedRequest, request),
            row = await previewRow(ctx, server(serverId)),
            now = Date.now()
        if (!holding(row, now, ["queued"]) || row!.createdAt !== requestedAt) return { recorded: false }
        const plan = failure === "owner" && row!.planId ? await ctx.db.get(row!.planId) : null
        if (plan) await backupDropPlan(ctx, plan, now)
        await ctx.db.patch(row!._id, {
            state: "failed",
            failure,
            ...(failure === "owner" ? { planId: undefined } : {}),
        })
        return { recorded: true }
    },
})
/** How long a run waits after a pass that recorded nothing before it tries again, so a passing failure does not keep the bot busy */
const BACKUP_RETRY_MS = 30000
/**
 * One pass of a confirmed restore is done. Claims past their window age to not confirmed, and the run goes on while items wait to start,
 * waits for claims that are still open, and ends once nothing is left, with the reason when the restore cannot go on. A pass that records
 * an item keeps the run alive for 10 more minutes, and a pass that records nothing tries again after 30 seconds, so a run the bot stopped
 * working on ends when its lease runs out. Each patch to running reports the job as due, so the bot runs the next pass at once
 */
export const runStep = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupRunStepResult> => {
        const { serverId, requestedAt, recorded, stopped } = decode(BackupRunStepRequest, request),
            row = await previewRow(ctx, server(serverId)),
            plan = row?.planId ? await ctx.db.get(row.planId) : null,
            now = Date.now()
        if (row?.state !== "running" || row.createdAt !== requestedAt || !plan) return { recorded: false }
        const byState = (state: "planned" | "reserved" | "claimed", limit: number) =>
            ctx.db
                .query("backupItems")
                .withIndex("by_plan_state", (q) => q.eq("planId", plan._id).eq("state", state))
                .take(limit)
        let aged = 0
        for (const state of ["reserved", "claimed"] as const)
            for (const item of await byState(state, BACKUP_RESTORE_LIMITS.page))
                if (item.dispatchExpiresAt !== undefined && item.dispatchExpiresAt < now - BACKUP_SETTLE_MS) {
                    await backupAgeItem(ctx, item, now)
                    aged++
                }
        if (aged) await backupSetRetention(ctx, plan)
        const waiting = (await byState("planned", 1)).length + (await byState("reserved", 1)).length > 0,
            claims = await byState("claimed", BACKUP_RESTORE_LIMITS.page)
        // A pass that recorded an item renews the run's lease, written with the job's next state in one patch
        const lease = recorded > 0 ? { expiresAt: now + BACKUP_RUN_IDLE_MS } : {}
        if (recorded > 0)
            await ctx.scheduler.runAt(now + BACKUP_RUN_IDLE_MS, internal.backup.previewExpire, { serverId })
        const end = async (failure?: BackupPreviewFailure): Promise<BackupRunStepResult> => {
            await ctx.db.patch(
                row._id,
                failure ? { state: "failed", failure, ...lease } : { state: "done", failure: undefined, ...lease },
            )
            // A run that settled every item is finished, so its plan no longer counts toward the server's plans
            if (!failure) await ctx.db.patch(plan._id, { settledAt: now })
            return { recorded: true, ended: failure ? { failure } : {} }
        }
        const wake = async (at: number) => {
            await ctx.db.patch(row._id, { state: "waiting", ...lease })
            await ctx.scheduler.runAt(at, internal.backup.runWake, { serverId, planId: plan._id })
        }
        if (stopped) return end("owner")
        if (waiting && (await backupPaused(ctx, serverId))) return end("paused")
        // Nothing can start until the open claims are confirmed or age, so the job sleeps until the first of them ages
        if (claims.length && (!waiting || recorded === 0))
            await wake(Math.min(...claims.map((x) => (x.dispatchExpiresAt ?? now) + BACKUP_SETTLE_MS)) + 1)
        else if (!waiting) return end()
        else if (recorded === 0) await wake(now + BACKUP_RETRY_MS)
        else await ctx.db.patch(row._id, { state: "running", ...lease })
        return { recorded: true }
    },
})
/** Takes the outcome a run that ended for lack of progress owes the owner, once, so the bot posts it in the DM. claimed is false when none is due */
export const outcomeClaim = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BackupOutcomeClaimResult> => {
        const { serverId, requestedAt } = decode(BackupOutcomeClaimRequest, request),
            row = await previewRow(ctx, server(serverId))
        if (!row?.outcomeDue || row.createdAt !== requestedAt) return { claimed: false }
        await ctx.db.patch(row._id, { outcomeDue: undefined })
        return { claimed: true }
    },
})
/** The claims a waiting restore slept for have aged, so the bot runs its next pass, which ends the job */
export const runWake = internalMutation({
    args: { serverId: v.string(), planId: v.id("backupPlans") },
    handler: async (ctx, { serverId, planId }) => {
        const row = await previewRow(ctx, serverId)
        if (row?.state !== "waiting" || row.planId !== planId) return
        await ctx.db.patch(row._id, { state: "running" })
        await ringWork(ctx)
    },
})

const viewArgs = { sessionToken: v.string(), serverId: v.string() }
/** The job and plan of the owner who made them, or nothing for anyone else */
async function ownedJob(ctx: QueryCtx, sessionToken: string, serverId: string) {
    const session = await dashboardSession(ctx, sessionToken, serverId),
        row = await previewRow(ctx, serverId)
    return { session, row: row?.ownerId === session.userId ? row : null }
}
/** The latest plan, for the owner who made it: its counts, gain and, once confirmed, how far the restore got, from the plan's own counts */
export const restoreView = dashboardQuery({
    args: viewArgs,
    handler: async (ctx, { sessionToken, serverId }): Promise<DashboardBackupRestore | null> => {
        const { row } = await ownedJob(ctx, sessionToken, serverId)
        if (!row) return null
        const plan = row.planId ? await ctx.db.get(row.planId) : null,
            states = Object.fromEntries(
                Object.entries(plan?.stateCounts ?? {}).filter(([, n]) => n > 0),
            ) as NonNullable<DashboardBackupRestore["plan"]>["states"]
        // A check the owner forgot, or one retention removed, is gone here as it is from `!backup status`
        if (row.planId && (!plan || plan.forgotten)) return null
        // A check that stopped coming in failed, and Check again starts a new one
        const stale = staleBuilding(plan, Date.now())
        return {
            state: stale ? "failed" : row.state,
            ...(stale ? { failure: "error" as const } : row.failure ? { failure: row.failure } : {}),
            plan: plan
                ? {
                      planId: plan._id,
                      planHash: plan.planHash,
                      backupId: plan.backupId,
                      match: plan.match,
                      createdAt: plan.createdAt,
                      confirmBefore: plan.expiresAt,
                      ...(plan.state === "building" ? { building: true as const } : {}),
                      ...(plan.confirmedAt !== undefined ? { confirmedAt: plan.confirmedAt } : {}),
                      itemCount: plan.itemCount,
                      counts: plan.counts,
                      gain: plan.gain,
                      warned: plan.warned ?? 0,
                      turnsOn: (plan.turnsOn ?? []).map((x) => ({ ...x, family: x.family as BackupItem["family"] })),
                      settled: plan.itemCount - backupUnsettled.reduce((n, state) => n + (states[state] ?? 0), 0),
                      states,
                  }
                : null,
        }
    },
})
/** One page of the plan's items, problems first, each with what it changes. Identical items and items left alone come only when asked for */
export const restoreItems = dashboardQuery({
    args: { ...viewArgs, planId: v.string(), identical: v.boolean(), cursor: v.union(v.string(), v.null()) },
    handler: async (
        ctx,
        { sessionToken, serverId, planId, identical, cursor },
    ): Promise<DashboardBackupItems | null> => {
        const { row } = await ownedJob(ctx, sessionToken, serverId),
            id = ctx.db.normalizeId("backupPlans", planId),
            plan = id ? await ctx.db.get(id) : null
        if (!row || !plan || row.planId !== plan._id || plan.forgotten) return null
        const page = await ctx.db
            .query("backupItems")
            .withIndex("by_plan_rank", (q) =>
                identical ? q.eq("planId", plan._id) : q.eq("planId", plan._id).lt("rank", BACKUP_IDENTICAL_RANK),
            )
            .paginate({ cursor, numItems: BACKUP_VIEW_PAGE })
        const items: DashboardBackupItems["items"] = []
        for (const x of page.page) {
            const {
                planHash: _hash,
                archiveDigest: _digest,
                planId: _plan,
                revision: _revision,
                ...item
            } = publicBackupItem(plan, x)
            const changes = await ctx.db
                    .query("backupChanges")
                    .withIndex("by_number", (q) =>
                        q.eq("serverId", serverId).eq("planId", plan._id).eq("itemNo", x.itemNo),
                    )
                    .unique(),
                parent =
                    x.dependencyItemNo === null
                        ? null
                        : await ctx.db
                              .query("backupItems")
                              .withIndex("by_number", (q) =>
                                  q.eq("serverId", serverId).eq("planId", plan._id).eq("itemNo", x.dependencyItemNo!),
                              )
                              .unique()
            // A category the plan creates is not on the server yet, so the page shows it by the archive's name
            const named = parent?.disposition === "create" ? parent.name : undefined
            items.push({
                ...item,
                changes: (changes?.changes ?? []).map((c) =>
                    named !== undefined && c.kind === "field" && c.path === "parentId" && c.after === parent!.sourceId
                        ? { ...c, after: named }
                        : c,
                ),
            })
        }
        return { items, ...(page.isDone ? {} : { nextCursor: page.continueCursor }) }
    },
})
/**
 * Ask the bot to read the archive and the server again. The bot rechecks with its own token that the requester still owns the server.
 * Answers whether the request was queued: it is not while another is in flight, within 10 seconds of the last or once the check is gone
 */
export const restoreRequest = mutation({
    args: { ...viewArgs, match: v.optional(v.boolean()) },
    handler: async (ctx, { sessionToken, serverId, match }) => {
        const { row } = await ownedJob(ctx, sessionToken, serverId),
            plan = row?.planId ? await ctx.db.get(row.planId) : null,
            now = Date.now()
        if (
            !row ||
            (row.planId && (!plan || plan.forgotten)) ||
            (plan?.state === "building" && !staleBuilding(plan, now)) ||
            holding(row, now, ["queued", ...restoring]) ||
            row.createdAt > now - BACKUP_PREVIEW_INTERVAL_MS
        )
            return false
        await ctx.db.patch(row._id, {
            state: "queued",
            createdAt: now,
            expiresAt: now + BACKUP_PREVIEW_MS,
            failure: undefined,
            ...(match !== undefined ? { match } : {}),
        })
        await ctx.scheduler.runAt(now + BACKUP_PREVIEW_MS, internal.backup.previewExpire, { serverId })
        await ringWork(ctx)
        return true
    },
})
/**
 * Confirms the plan the owner is looking at: the plan must be the job's plan and carry the hash the page showed, so an old page cannot confirm
 * a newer check. The bot then runs it. A repeat answers the same result
 */
export const restoreConfirm = mutation({
    args: { ...viewArgs, planId: v.string(), planHash: v.string() },
    handler: async (ctx, { sessionToken, serverId, planId, planHash }): Promise<{ confirmedAt: number }> => {
        const { session, row } = await ownedJob(ctx, sessionToken, serverId),
            id = ctx.db.normalizeId("backupPlans", planId),
            plan = id ? await ctx.db.get(id) : null,
            now = Date.now()
        if (!row) fail(403, "Only the server owner who made the check can restore")
        if (
            !plan ||
            row.planId !== plan._id ||
            plan.ownerId !== session.userId ||
            plan.planHash !== planHash ||
            plan.forgotten
        )
            fail(409, "This check is out of date. Check again")
        if (plan.confirmedAt !== undefined) return { confirmedAt: plan.confirmedAt }
        if (row.state !== "done" || plan.state === "building") fail(409, "A check or a restore is running")
        if (now >= plan.expiresAt) fail(409, "This check expired. Check again")
        await ctx.db.patch(plan._id, { confirmedAt: now })
        await startRun(
            ctx,
            plan,
            { ownerId: plan.ownerId, channelId: row.channelId, messageId: row.messageId },
            now,
            false,
        )
        return { confirmedAt: now }
    },
})
/** Ends what the bot did not finish in time: a refresh nobody answered, or a run that made no progress for 10 minutes */
export const previewExpire = internalMutation({
    args: { serverId: v.string() },
    handler: async (ctx, { serverId }) => {
        const row = await previewRow(ctx, serverId)
        if (!row || row.expiresAt > Date.now()) return
        if (row.state === "queued") await ctx.db.patch(row._id, { state: "failed", failure: "unanswered" })
        else if (row.state === "running" || row.state === "waiting") {
            // A run from chat tells the owner how it ended, so the bot takes the outcome to post on its next pass
            await ctx.db.patch(row._id, {
                state: "failed",
                failure: "expired",
                ...(row.notify ? { outcomeDue: true as const } : {}),
            })
            if (row.notify) await ringWork(ctx)
        }
    },
})
