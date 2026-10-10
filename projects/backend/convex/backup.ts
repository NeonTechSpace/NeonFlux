import { v } from "convex/values"
import type { BackupConfigObject, BackupContext, BackupItemBinding, BackupManageResult, BackupManifest, BackupNativeProof, BackupPreview, BackupPreviewFailure, BackupPreviewItem, BackupPreviewJob, BackupPreviewPage, BackupQueryResult, BackupSnapshot, BackupStructureObject, BackupWorkResult, BackupXpObject } from "../contracts.js"
import type { DashboardBackupPreview } from "../dashboard-contracts.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { internalMutation, mutation, query as dashboardQuery, type MutationCtx, type QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { Doc } from "./_generated/dataModel.js"
import { dashboardSession } from "./dashboard.ts"
import { ringWork } from "./workSignal.ts"
import { BACKUP_DISPATCH_MS, BACKUP_PLAN_MS, BACKUP_RETENTION, BACKUP_SETTLE_MS, backupCapabilities, backupChannelSemantic, backupContext, backupDigest, backupFamilies, backupHash, backupManifest, backupNativeProof, backupProvider, backupSelection, backupSemantic, backupStructure, canonicalBackupJson } from "./backupDomain.ts"
import { selectedBackupSnapshot } from "./backupProjections.ts"
import { backupImports } from "./backupImports.ts"
import { type BackupRead, backupBinding, backupConfigMappingsCurrent,backupGrant, backupItemRow, backupMappedChannel, backupMappedConfig, backupNativeAccess, backupNativeDecision, backupOriginCapacity, backupOriginRow, backupOwner, backupPlanOwner, backupPlanRow, backupPlanUnresolved, backupReusableOrigin, backupRewriteConfig, backupSetRetention, publicBackupItem, publicBackupOrigin, publicBackupPlan } from "./backupStore.ts"
import { claimToken } from "./rolesDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, integer, object, requireId, requireServer, source } from "./validation.ts"

function server(value: unknown) { const id = requireId(value); requireServer(id); return id }
const { backupConfigurationCapacity, backupConfigReferences, backupCurrentConfig, backupCurrentXp, backupImportConfig, backupImportXp, backupValidateConfigReferences } = backupImports
function cursor(value: unknown): string | null { if (value === undefined) return null; if (typeof value !== "string" || !value.length || value.length > 4096) fail(400, "Invalid backup cursor"); return value }
function native(value: unknown, serverId: string, context: BackupContext) { return value === null ? null : backupNativeProof(value, serverId, context) }
const terminal = (item: Doc<"backupItems">) => ["created", "skipped", "conflict", "blocked", "failed", "uncertain"].includes(item.state)
export const snapshot = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<BackupSnapshot> => {
    const r = shape(request, ["serverId", "context", "selected"], ["serverId", "context", "selected"]), serverId = server(r.serverId), context = backupContext(r.context), selected = backupSelection(r.selected, false)
    await backupOwner(ctx, serverId, context)
    return selectedBackupSnapshot(ctx, serverId, selected)
} })
export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<BackupQueryResult> => {
    const r = shape(request, ["serverId", "context", "operation"], ["serverId", "context", "operation"]), serverId = server(r.serverId), context = backupContext(r.context), op = object(r.operation)
    await backupOwner(ctx, serverId, context)
    if (op.type === "capabilities") { shape(op, ["type"], ["type"]); return { type: "capabilities", capabilities: backupCapabilities() } }
    if (op.type === "plans") {
        shape(op, ["type", "cursor"], ["type"])
        const rows = await ctx.db.query("backupPlans").withIndex("by_server", q => q.eq("serverId", serverId)).paginate({ cursor: cursor(op.cursor), numItems: 20 })
        return { type: "plans", plans: rows.page.filter(x => x.ownerId === context.ownerId && x.provider === context.provider).map(publicBackupPlan), ...(!rows.isDone ? { nextCursor: rows.continueCursor } : {}) }
    }
    if (op.type === "origins") {
        shape(op, ["type", "provider", "cursor"], ["type", "provider"]); const provider = backupProvider(op.provider); if (provider !== context.provider) fail(403, "Provider mismatch")
        const rows = await ctx.db.query("backupOrigins").withIndex("by_server", q => q.eq("serverId", serverId).eq("provider", provider)).paginate({ cursor: cursor(op.cursor), numItems: 20 })
        return { type: "origins", origins: rows.page.map(publicBackupOrigin), ...(!rows.isDone ? { nextCursor: rows.continueCursor } : {}) }
    }
    if (op.type === "item") {
        shape(op, ["type", "binding"], ["type", "binding"]); const { plan, item } = await backupItemRow(ctx, serverId, backupBinding(op.binding, true) as BackupItemBinding); backupPlanOwner(plan, context)
        return { type: "item", item: publicBackupItem(plan, item), object: item.object as BackupConfigObject | BackupXpObject | BackupStructureObject | undefined ?? null }
    }
    if (op.type === "preview") {
        shape(op, ["type", "page"], ["type", "page"])
        const row = await previewRow(ctx, serverId)
        return { type: "preview", preview: row?.preview && row.ownerId === context.ownerId ? previewPage(row.preview as BackupPreview, integer(op.page, 1, 20)) : null }
    }
    const binding = backupBinding(op.binding), plan = await backupPlanRow(ctx, serverId, binding); backupPlanOwner(plan, context)
    if (op.type === "plan") { shape(op, ["type", "binding"], ["type", "binding"]); return { type: "plan", plan: publicBackupPlan(plan) } }
    if (op.type === "items") {
        shape(op, ["type", "binding", "cursor"], ["type", "binding"])
        const rows = await ctx.db.query("backupItems").withIndex("by_plan", q => q.eq("planId", plan._id)).paginate({ cursor: cursor(op.cursor), numItems: 20 })
        return { type: "items", items: rows.page.map(x => publicBackupItem(plan, x)), ...(!rows.isDone ? { nextCursor: rows.continueCursor } : {}) }
    }
    fail(400, "Invalid backup query")
} })

type PlannedItem = Omit<Doc<"backupItems">, "_id" | "_creationTime" | "planId">
function backupRestorable(manifest: BackupManifest, serverId: string, context: BackupContext) {
    if (manifest.serverId !== serverId || manifest.provider !== context.provider) fail(403, "Same-server and same-provider restore required")
    if (manifest.config.length + manifest.xp.length + manifest.structure.length > 500 || new TextEncoder().encode(canonicalBackupJson(manifest)).length > 524288) fail(413, "Restore plan exceeds 500 items or 512 KiB")
}
/** What a restore plan does with each archive item against the server as the fresh native evidence shows it. Plans store these items, and
 *  previews show them without storing a plan, so both always decide alike. It only reads */
async function backupPlanItems(ctx: BackupRead, serverId: string, manifest: BackupManifest, context: BackupContext, proof: BackupNativeProof | null) {
    const counts = { create: 0, skip: 0, conflict: 0, blocked: 0 }, prepared: PlannedItem[] = [], pendingChannels = new Map<string, string>(), parentNumbers = new Map<string, number>()
    for (const object of [...manifest.structure].sort((a, b) => Number(b.type === "category") - Number(a.type === "category") || a.sourceId.localeCompare(b.sourceId))) {
        const decision = await backupNativeDecision(ctx, { serverId, provider: manifest.provider }, object, proof, new Set(parentNumbers.keys())), itemNo = prepared.length + 1
        const dependencyItemNo = object.parentId !== null ? parentNumbers.get(object.parentId) ?? null : null
        // Configuration names a forum or media channel as a message channel, such as a suggestion forum
        if (decision.disposition === "create") pendingChannels.set(object.sourceId, object.type === "forum" || object.type === "media" ? "text" : object.type)
        if (object.type === "category" && ["create", "skip"].includes(decision.disposition)) parentNumbers.set(object.sourceId, itemNo)
        counts[decision.disposition]++
        prepared.push({ serverId, itemNo, generation: 1, category: "structure", family: "structure", sourceId: object.sourceId, ...decision, state: "planned", desiredHash: await backupHash(backupChannelSemantic(object)), dependencyItemNo, disabledOnCreate: false, object })
    }
    for (const object of [...manifest.config].sort((a, b) => backupFamilies.indexOf(a.family) - backupFamilies.indexOf(b.family) || a.sourceId.localeCompare(b.sourceId))) {
        const configMappings: NonNullable<Doc<"backupItems">["configMappings"]> = []
        for (const sourceId of new Set(backupConfigReferences(object).filter(x => x.type === "text" || x.type === "category").map(x => x.id))) {
            const origin = await backupOriginRow(ctx, serverId, manifest.provider, "structure", "structure", sourceId), pending = prepared.find(x => x.category === "structure" && x.sourceId === sourceId && x.disposition === "create")
            configMappings.push({ sourceId, targetId: pending ? null : origin?.mappedId ?? sourceId, targetItemNo: pending?.itemNo ?? null })
        }
        const mapped = await backupMappedConfig(ctx, { serverId, provider: manifest.provider }, object), effective = mapped ?? object
        const pendingTarget = object.family === "cleanupPolicy" && configMappings.some(x => x.sourceId === object.value.channelId && x.targetId === null)
        const current = pendingTarget ? { row: null, value: null, hash: await backupHash(null) } : await backupCurrentConfig(ctx, serverId, effective), origin = await backupOriginRow(ctx, serverId, manifest.provider, "config", object.family, object.sourceId), identical = current.value && !configMappings.some(x => x.targetId === null) && canonicalBackupJson(backupSemantic(current.value)) === canonicalBackupJson(backupSemantic(effective))
        const reason = !mapped ? "Referenced native origin unresolved" : origin && origin.state !== "created" ? "Prior origin import unresolved" : current.row ? identical ? null : "Existing authored configuration conflicts" : origin ? "Retained origin target missing, no replay" : await backupValidateConfigReferences(ctx, serverId, effective, context, proof, pendingChannels) ?? await backupConfigurationCapacity(ctx, serverId, effective, prepared.filter(x => x.category === "config" && x.disposition === "create").map(x => x.object as BackupConfigObject))
        const disposition = !mapped ? "blocked" as const : current.row ? identical ? "skip" as const : "conflict" as const : reason ? "blocked" as const : "create" as const
        counts[disposition]++
        prepared.push({ serverId, itemNo: prepared.length + 1, generation: 1, category: "config", family: object.family, sourceId: object.sourceId, disposition, reason, state: "planned", expectedHash: current.hash, desiredHash: await backupHash(backupSemantic(effective)), dependencyItemNo: null, mappedId: current.row?._id ?? null, disabledOnCreate: object.family !== "draft", object, configMappings })
    }
    for (const object of manifest.xp) {
        const current = await backupCurrentXp(ctx, serverId, object), origin = await backupOriginRow(ctx, serverId, manifest.provider, "xp", "xp", object.sourceId), xpState = await ctx.db.query("levelingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique(), capacity = (xpState?.profiles ?? 0) + prepared.filter(x => x.category === "xp" && x.disposition === "create").length >= 50000, disposition = current.row ? current.xp === object.xp ? "skip" as const : "conflict" as const : origin || capacity ? "blocked" as const : "create" as const
        counts[disposition]++
        prepared.push({ serverId, itemNo: prepared.length + 1, generation: 1, category: "xp", family: "xp", sourceId: object.sourceId, disposition, reason: disposition === "conflict" ? "Existing effective XP conflicts" : disposition === "blocked" ? capacity ? "XP profile capacity reached" : "Retained origin target missing, no replay" : null, state: "planned", expectedHash: current.hash, desiredHash: await backupHash(object), dependencyItemNo: null, mappedId: current.row?._id ?? null, disabledOnCreate: false, object })
    }
    return { counts, prepared }
}

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<BackupManageResult> => {
    const r = shape(request, ["serverId", "messageId", "createdAt", "context", "operation"], ["serverId", "messageId", "createdAt", "context", "operation"]), identity = source(r, Date.now()), context = backupContext(r.context), op = object(r.operation), serverId = identity.serverId
    await backupOwner(ctx, serverId, context)
    if (op.type === "plan") {
        shape(op, ["type", "manifest", "archiveDigest", "native"], ["type", "manifest", "archiveDigest", "native"])
        const manifest = backupManifest(op.manifest), archiveDigest = backupDigest(op.archiveDigest), manifestDigest = await backupHash(manifest), proof = native(op.native, serverId, context)
        backupRestorable(manifest, serverId, context)
        const previous =await ctx.db.query("backupPlans").withIndex("by_source", q => q.eq("serverId", serverId).eq("messageId", identity.messageId)).unique()
        if (previous) {
            if (previous.ownerId !== context.ownerId || previous.archiveDigest !== archiveDigest || previous.manifestDigest !== manifestDigest || previous.sourceCreatedAt !== identity.createdAt) fail(409, "Backup source binding changed")
            const rows = await ctx.db.query("backupItems").withIndex("by_plan", q => q.eq("planId", previous._id)).paginate({ cursor: null, numItems: 20 })
            return { type: "plan", duplicate: true, plan: publicBackupPlan(previous), items: rows.page.map(x => publicBackupItem(previous, x)), ...(!rows.isDone ? { nextCursor: rows.continueCursor } : {}) }
        }
        if ((await ctx.db.query("backupPlans").withIndex("by_server", q => q.eq("serverId", serverId)).take(11)).length >= 10) fail(429, "Restore plan capacity reached")
        const now = Date.now(), { counts, prepared } = await backupPlanItems(ctx, serverId, manifest, context, proof)
        const planHash = await backupHash({ ownerId: context.ownerId, provider: context.provider, archiveDigest, manifestDigest, expiresAt: now + BACKUP_PLAN_MS, items: prepared }), id = await ctx.db.insert("backupPlans", { serverId, ownerId: context.ownerId, provider: manifest.provider, backupId: manifest.backupId, messageId: identity.messageId, sourceCreatedAt: identity.createdAt, archiveDigest, manifestDigest, planHash, revision: 1, createdAt: now, expiresAt: now + BACKUP_PLAN_MS, cleanupAt: now + BACKUP_PLAN_MS + BACKUP_RETENTION, itemCount: prepared.length, counts, forgotten: false })
        for (const item of prepared) await ctx.db.insert("backupItems", { ...item, planId: id })
        const plan = (await ctx.db.get(id))!, rows = await ctx.db.query("backupItems").withIndex("by_plan", q => q.eq("planId", id)).paginate({ cursor: null, numItems: 20 })
        return { type: "plan", duplicate: false, plan: publicBackupPlan(plan), items: rows.page.map(x => publicBackupItem(plan, x)), ...(!rows.isDone ? { nextCursor: rows.continueCursor } : {}) }
    }
    shape(op, ["type", "binding"], ["type", "binding"])
    const plan = await backupPlanRow(ctx, serverId, backupBinding(op.binding)); backupPlanOwner(plan, context)
    if (op.type === "confirm") {
        if (plan.forgotten || Date.now() >= plan.expiresAt) fail(409, "Restore plan expired or forgotten")
        if (plan.confirmedAt !== undefined) return { type: "confirmed", duplicate: true, plan: publicBackupPlan(plan) }
        await ctx.db.patch(plan._id, { confirmedAt: Date.now() })
        return { type: "confirmed", duplicate: false, plan: publicBackupPlan((await ctx.db.get(plan._id))!) }
    }
    if (op.type === "forget") {
        if (await backupPlanUnresolved(ctx, plan._id)) fail(409, "Unresolved restore anchors retained")
        const items = await ctx.db.query("backupItems").withIndex("by_plan", q => q.eq("planId", plan._id)).take(501)
        for (const item of items) await ctx.db.patch(item._id, { object: undefined, desiredChannel: undefined, returnedChannel: undefined, ...(item.state === "planned" ? { state: "blocked", reason: "Plan forgotten", finishedAt: Date.now(), noDispatch: true } : {}) })
        await ctx.db.patch(plan._id, { forgotten: true })
        await backupSetRetention(ctx, plan)
        return { type: "forgotten", plan: publicBackupPlan((await ctx.db.get(plan._id))!) }
    }
    fail(400, "Invalid backup management operation")
} })

async function updated(ctx: MutationCtx, plan: Doc<"backupPlans">, item: Doc<"backupItems">): Promise<BackupWorkResult> { return { type: "item", item: publicBackupItem(plan, (await ctx.db.get(item._id))!) } }
async function block(ctx: MutationCtx, plan: Doc<"backupPlans">, item: Doc<"backupItems">, reason: string, state: "blocked" | "conflict" = "blocked") {
    if (item.claimedAt !== undefined) fail(409, "Claimed native work cannot be classified as undispatched")
    await ctx.db.patch(item._id, { state, reason, finishedAt: Date.now(), noDispatch: true })
    if (item.originId) { const origin = await ctx.db.get(item.originId); if (origin?.state === "reserved" && origin.planId === plan._id && origin.itemNo === item.itemNo) await ctx.db.patch(origin._id, { state: "failed", noDispatch: true }) }
    await backupSetRetention(ctx, plan)
    return updated(ctx, plan, item)
}
export const work = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<BackupWorkResult> => {
    const r = shape(request, ["serverId", "operation"], ["serverId", "operation"]), serverId = server(r.serverId), op = object(r.operation), binding = backupBinding(op.binding, true) as BackupItemBinding, { plan, item } = await backupItemRow(ctx, serverId, binding), now = Date.now()
    if (op.type === "outcome") {
        shape(op, ["type", "binding", "claimToken", "outcome", "noDispatch", "channel", "mappedId"], ["type", "binding", "claimToken", "outcome", "channel", "mappedId"])
        if (item.category !== "structure" || item.claimedAt === undefined || item.claimToken !== claimToken(op.claimToken) || !item.originId) fail(409, "Restore claim capability mismatch")
        if (!["created", "failed", "uncertain"].includes(String(op.outcome)) || op.noDispatch !== undefined && op.noDispatch !== true) fail(400, "Invalid restore outcome")
        const mappedId = op.mappedId === null ? null : requireId(op.mappedId), channel = op.channel === null ? null : backupStructure(op.channel)
        if (channel && mappedId === null || op.outcome === "created" && !channel || mappedId && !channel && op.outcome !== "uncertain" || op.noDispatch && (mappedId || op.outcome !== "failed")) fail(400, "Invalid native creation response")
        if (channel && (channel.sourceId !== mappedId || op.outcome === "created" && canonicalBackupJson(backupChannelSemantic(channel)) !== canonicalBackupJson(backupChannelSemantic(item.desiredChannel!)))) fail(409, "Native response does not bind exact creation snapshot")
        if (item.mappedId && item.mappedId !== mappedId) fail(409, "Conflicting native result identity")
        if (item.historicalOutcome === op.outcome && item.mappedId === mappedId && Boolean(item.noDispatch) === Boolean(op.noDispatch)) return updated(ctx, plan, item)
        const origin = await ctx.db.get(item.originId)
        if (!origin || origin.planId !== plan._id || origin.itemNo !== item.itemNo || origin.generation !== item.generation) fail(409, "Origin generation changed")
        if (item.historicalOutcome !== undefined) {
            // A late identity-bearing callback keeps the original uncertain outcome
            if (item.historicalOutcome === "uncertain" && mappedId && !op.noDispatch && (item.mappedId === null || item.mappedId === mappedId)) {
                if (item.returnedChannel && channel && canonicalBackupJson(item.returnedChannel) !== canonicalBackupJson(channel)) fail(409, "Conflicting late native snapshot")
                await ctx.db.patch(item._id, { mappedId, ...(channel ? { returnedChannel: channel } : {}) }); await ctx.db.patch(origin._id, { mappedId }); return updated(ctx, plan, item)
            }
            fail(409, "Immutable restore outcome already recorded")
        }
        await ctx.db.patch(item._id, { state: op.outcome as "created" | "failed" | "uncertain", historicalOutcome: op.outcome as "created" | "failed" | "uncertain", mappedId, finishedAt: now, ...(channel ? { returnedChannel: channel } : {}), ...(op.noDispatch ? { noDispatch: true } : {}) })
        await ctx.db.patch(origin._id, { state: op.outcome as "created" | "failed" | "uncertain", mappedId, ...(op.noDispatch ? { noDispatch: true } : {}) })
        await backupSetRetention(ctx, plan)
        return updated(ctx, plan, item)
    }
    if (!["apply", "reserve", "claim", "reconcile"].includes(String(op.type))) fail(400, "Invalid backup work operation")
    const keys = ["type", "binding", "context", "native", ...(op.type === "reserve" || op.type === "claim" ? ["claimToken"] : [])]
    shape(op, keys, ["type", "binding", "context", "native"])
    const context = backupContext(op.context); backupPlanOwner(plan, context); await backupOwner(ctx, serverId, context)
    if (op.type === "reconcile") {
        shape(op, ["type", "binding", "context", "native"], ["type", "binding", "context", "native"])
        const proof = backupNativeProof(op.native, serverId, context)
        if (item.category !== "structure" || !item.mappedId || !item.originId || item.claimedAt === undefined || now < (item.dispatchExpiresAt ?? plan.expiresAt) + BACKUP_SETTLE_MS) fail(409, "Known response-bound identity and closed dispatch required")
        const observation = proof.observations.find(x => x.sourceId === item.mappedId)
        if (!observation || observation.status === "unknown") fail(409, "Exact native identity observation required")
        if (observation.status === "present" && observation.channel!.sourceId !== item.mappedId) fail(409, "Observation identity mismatch")
        const resolution = observation.status === "absent" ? "absent" as const : canonicalBackupJson(backupChannelSemantic(observation.channel!)) === canonicalBackupJson(backupChannelSemantic(item.desiredChannel!)) ? "match" as const : "conflict" as const
        const origin = await ctx.db.get(item.originId); if (!origin || origin.planId !== plan._id || origin.itemNo !== item.itemNo) fail(409, "Origin binding changed")
        await ctx.db.patch(item._id, { resolution }); await ctx.db.patch(origin._id, { resolved: resolution, ...(resolution === "match" ? { state: "created" } : {}) })
        await backupSetRetention(ctx, plan)
        return updated(ctx, plan, item)
    }
    if (terminal(item)) return updated(ctx, plan, item)
    backupPlanOwner(plan, context, true); await backupOwner(ctx, serverId, context, false)
    const proof = native(op.native, serverId, context)
    if (item.disposition === "blocked" || item.disposition === "conflict") return block(ctx, plan, item, item.reason ?? "Preview blocked this item", item.disposition)
    if (op.type === "apply") {
        shape(op, ["type", "binding", "context", "native"], ["type", "binding", "context", "native"])
        if (item.category === "structure") {
            if (item.disposition !== "skip") fail(400, "Native create requires reserve and claim")
            const object = backupStructure(item.object), mapped = await backupMappedChannel(ctx, plan, object)
            if (!mapped) return block(ctx, plan, item, "Parent origin unresolved")
            const decision = await backupNativeDecision(ctx, plan, mapped, proof)
            if (decision.disposition !== "skip" || decision.expectedHash !== item.expectedHash) return block(ctx, plan, item, decision.reason ?? "Native state changed", "conflict")
            const old = await backupOriginRow(ctx, serverId, plan.provider, "structure", "structure", item.sourceId)
            if (!old) { await backupOriginCapacity(ctx, serverId, plan.provider); await ctx.db.insert("backupOrigins", { serverId, provider: plan.provider, category: "structure", family: "structure", sourceId: item.sourceId, state: "created", planId: plan._id, itemNo: item.itemNo, generation: 1, mappedId: decision.mappedId, desiredHash: item.desiredHash }) }
            await ctx.db.patch(item._id, { state: "skipped", mappedId: decision.mappedId, finishedAt: now, noDispatch: true }); return updated(ctx, plan, item)
        }
        let result: { created: boolean, mappedId: string }
        if (item.category === "xp") {
            const object = item.object as BackupXpObject, current = await backupCurrentXp(ctx, serverId, object)
            if (current.hash !== item.expectedHash) return block(ctx, plan, item, "XP epoch, adjustment or effective score changed", "conflict")
            if (item.disposition === "create" && await backupOriginRow(ctx, serverId, plan.provider, "xp", "xp", item.sourceId)) return block(ctx, plan, item, "Origin already imported")
            result = await backupImportXp(ctx, serverId, object)
        } else {
            const object = await backupMappedConfig(ctx, plan, item.object)
            if (!object) return block(ctx, plan, item, "Referenced native origin unresolved")
            if (!await backupConfigMappingsCurrent(ctx, plan, item.configMappings ?? [])) return block(ctx, plan, item, "Referenced native mapping changed after preview", "conflict")
            const preview = await backupRewriteConfig(item.object, async id => item.configMappings?.find(x => x.sourceId === id)?.targetId ?? id)
            if (await backupHash(backupSemantic(preview)) !== item.desiredHash) return block(ctx, plan, item, "Configuration intent changed after preview", "conflict")
            const current = await backupCurrentConfig(ctx, serverId, object)
            if (current.hash !== item.expectedHash) return block(ctx, plan, item, "Authored configuration or revision changed", "conflict")
            const denied = await backupValidateConfigReferences(ctx, serverId, object, context, proof)
            if (denied) return block(ctx, plan, item, denied)
            if (item.disposition === "create" && await backupOriginRow(ctx, serverId, plan.provider, "config", item.family, item.sourceId)) return block(ctx, plan, item, "Origin already imported")
            result = await backupImportConfig(ctx, serverId, object, plan.ownerId)
        }
        const origin = await backupOriginRow(ctx, serverId, plan.provider, item.category, item.family, item.sourceId)
        if (!origin) { await backupOriginCapacity(ctx, serverId, plan.provider); await ctx.db.insert("backupOrigins", { serverId, provider: plan.provider, category: item.category, family: item.family, sourceId: item.sourceId, state: "created", planId: plan._id, itemNo: item.itemNo, generation: 1, mappedId: result.mappedId, desiredHash: item.desiredHash }) }
        await ctx.db.patch(item._id, { state: result.created ? "created" : "skipped", mappedId: result.mappedId, finishedAt: now, noDispatch: true }); return updated(ctx, plan, item)
    }
    if (op.type !== "reserve" && op.type !== "claim") fail(400, "Invalid backup work operation")
    shape(op, ["type", "binding", "context", "native", "claimToken"], ["type", "binding", "context", "native"])
    if (item.category !== "structure" || item.disposition !== "create" || !proof) fail(400, "Native creation evidence required")
    if (item.state === "claimed") return { type: "grant", item: publicBackupItem(plan, item), grant: backupGrant(plan, item), claimed: false }
    const original = backupStructure(item.object), channel = await backupMappedChannel(ctx, plan, original)
    if (!channel) return block(ctx, plan, item, "Parent origin unresolved")
    if (item.dependencyItemNo !== null) { const parent = await ctx.db.query("backupItems").withIndex("by_number", q => q.eq("serverId", serverId).eq("planId", plan._id).eq("itemNo", item.dependencyItemNo!)).unique(); if (!parent || !["created", "skipped"].includes(parent.state) || !parent.mappedId) return block(ctx, plan, item, "Selected parent has not been created or verified") }
    const denied = backupNativeAccess(channel, proof, serverId)
    if (denied) return block(ctx, plan, item, denied)
    const observation = proof.observations.find(x => x.sourceId === original.sourceId)
    if (!observation || observation.status !== "absent") return block(ctx, plan, item, "Original exact native identity is no longer absent", "conflict")
    if (item.state === "planned") {
        if (op.type !== "reserve") fail(409, "Reserve native item before claim")
        const prior = await backupOriginRow(ctx, serverId, plan.provider, "structure", "structure", item.sourceId)
        if (prior && !backupReusableOrigin(prior)) return block(ctx, plan, item, "Origin creation already reserved or retained")
        const originFields = { serverId, provider: plan.provider, category: "structure" as const, family: "structure", sourceId: item.sourceId, state: "reserved" as const, planId: plan._id, itemNo: item.itemNo, generation: 1 as const, mappedId: null, desiredHash: item.desiredHash }
        let originId
        if (prior) { originId = prior._id; await ctx.db.patch(prior._id, { ...originFields, noDispatch: undefined, resolved: undefined }) }
        else { await backupOriginCapacity(ctx, serverId, plan.provider); originId = await ctx.db.insert("backupOrigins", originFields) }
        const dispatchExpiresAt = Math.min(plan.expiresAt, now + BACKUP_DISPATCH_MS)
        await ctx.db.patch(item._id, { state: "reserved", originId, desiredChannel: channel, dispatchExpiresAt, botId: context.botId }); await ctx.db.patch(plan._id, { cleanupAt: undefined })
        const reserved = (await ctx.db.get(item._id))!; return { type: "grant", item: publicBackupItem(plan, reserved), grant: backupGrant(plan, reserved), claimed: false }
    }
    if (op.type === "reserve") return { type: "grant", item: publicBackupItem(plan, item), grant: backupGrant(plan, item), claimed: false }
    if (item.state !== "reserved" || !item.originId || now >= item.dispatchExpiresAt! || item.botId !== context.botId || canonicalBackupJson(channel) !== canonicalBackupJson(item.desiredChannel)) fail(409, "Native reservation changed or expired")
    const token = claimToken(op.claimToken), origin = await ctx.db.get(item.originId)
    if (!origin || origin.state !== "reserved" || origin.planId !== plan._id || origin.itemNo !== item.itemNo) fail(409, "Origin reservation changed")
    await ctx.db.patch(item._id, { state: "claimed", claimedAt: now, claimToken: token }); await ctx.db.patch(origin._id, { state: "claimed" })
    const claimed = (await ctx.db.get(item._id))!; return { type: "grant", item: publicBackupItem(plan, claimed), grant: backupGrant(plan, claimed), claimed: true }
} })

// The read-only restore preview. It runs the plan's own decisions on fresh native evidence and stores only the latest preview of each
// server, with the DM message that carries its archive, so the owner can page it in chat and refresh it from the website
/** Preview items per page, in chat and on the website */
export const BACKUP_PREVIEW_PAGE = 25
/** How long the bot has to answer a website refresh */
export const BACKUP_PREVIEW_MS = 60000
/** A new refresh waits this long after the previous one, so the refresh button cannot keep the bot reading Fluxer and the archive */
export const BACKUP_PREVIEW_INTERVAL_MS = 10000
const previewRow = (ctx: Pick<QueryCtx, "db">, serverId: string) => ctx.db.query("dashboardBackupPreviewJobs").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
function previewPage(preview: BackupPreview, page: number): BackupPreviewPage {
    const pages = Math.max(1, Math.ceil(preview.items.length / BACKUP_PREVIEW_PAGE)), current = Math.min(page, pages)
    return { backupId: preview.backupId, archiveDigest: preview.archiveDigest, checkedAt: preview.checkedAt, counts: preview.counts, itemCount: preview.items.length, page: current, pages,
        items: preview.items.slice((current - 1) * BACKUP_PREVIEW_PAGE, current * BACKUP_PREVIEW_PAGE) }
}
const previewItem = (item: PlannedItem): BackupPreviewItem => ({ itemNo: item.itemNo, category: item.category, family: item.family as BackupPreviewItem["family"], sourceId: item.sourceId,
    ...(item.category === "structure" ? { name: (item.object as BackupStructureObject).name } : {}), disposition: item.disposition, reason: item.reason })
export const preview = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<BackupPreviewPage> => {
    const keys = ["serverId", "context", "manifest", "archiveDigest", "native", "archive", "page"], r = shape(request, keys, keys), serverId = server(r.serverId), context = backupContext(r.context)
    await backupOwner(ctx, serverId, context)
    const manifest = backupManifest(r.manifest), archiveDigest = backupDigest(r.archiveDigest), proof = native(r.native, serverId, context), archive = shape(r.archive, ["channelId", "messageId"], ["channelId", "messageId"])
    const channelId = requireId(archive.channelId), messageId = requireId(archive.messageId), page = integer(r.page, 1, 20)
    if (channelId !== context.dmChannelId) fail(403, "The archive must be in the owner's private DM")
    backupRestorable(manifest, serverId, context)
    const { counts, prepared } = await backupPlanItems(ctx, serverId, manifest, context, proof), now = Date.now()
    const result: BackupPreview = { backupId: manifest.backupId, archiveDigest, checkedAt: now, counts, items: prepared.map(previewItem) }
    const row = await previewRow(ctx, serverId), fields = { ownerId: context.ownerId, state: "done" as const, createdAt: row?.state === "queued" ? row.createdAt : now, expiresAt: now, channelId, messageId, preview: result }
    if (row) await ctx.db.patch(row._id, { ...fields, failure: undefined })
    else await ctx.db.insert("dashboardBackupPreviewJobs", { serverId, ...fields })
    return previewPage(result, page)
} })
/** The archive the website waits for the bot to read again */
export const previewReady = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<{ job: BackupPreviewJob | null }> => {
    const row = await previewRow(ctx, server(object(request).serverId))
    return { job: row?.state === "queued" && row.expiresAt > Date.now() ? { ownerId: row.ownerId, channelId: row.channelId, messageId: row.messageId } : null }
} })
const failures = new Set<string>(["owner", "archive", "key", "refused", "error"] satisfies BackupPreviewFailure[])
/** Why the bot could not refresh a waiting preview. A sender who no longer owns the server loses the stored preview */
export const previewFailed = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const r = shape(request, ["serverId", "failure"], ["serverId", "failure"]), row = await previewRow(ctx, server(r.serverId))
    if (!failures.has(String(r.failure))) fail(400, "Invalid preview failure")
    if (row?.state !== "queued" || row.expiresAt <= Date.now()) return { recorded: false }
    await ctx.db.patch(row._id, { state: "failed", failure: r.failure as BackupPreviewFailure, ...(r.failure === "owner" ? { preview: undefined } : {}) })
    return { recorded: true }
} })

const viewArgs = { sessionToken: v.string(), serverId: v.string() }
/** The latest preview, for the owner who made it */
export const previewView = dashboardQuery({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardBackupPreview | null> => {
    const session = await dashboardSession(ctx, sessionToken, serverId), row = await previewRow(ctx, serverId)
    if (!row || row.ownerId !== session.userId) return null
    return { serverId, state: row.state, requestedAt: row.createdAt, ...(row.failure ? { failure: row.failure } : {}), preview: row.preview as BackupPreview | undefined ?? null }
} })
/** Ask the bot to read the archive and the server again. The bot rechecks with its own token that the requester still owns the server */
export const previewRequest = mutation({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }) => {
    const session = await dashboardSession(ctx, sessionToken, serverId), row = await previewRow(ctx, serverId), now = Date.now()
    if (!row || row.ownerId !== session.userId || row.state === "queued" && row.expiresAt > now || row.createdAt > now - BACKUP_PREVIEW_INTERVAL_MS) return null
    await ctx.db.patch(row._id, { state: "queued", createdAt: now, expiresAt: now + BACKUP_PREVIEW_MS, failure: undefined })
    await ctx.scheduler.runAt(now + BACKUP_PREVIEW_MS, internal.backup.previewExpire, { serverId })
    await ringWork(ctx)
    return null
} })
export const previewExpire = internalMutation({ args: { serverId: v.string() }, handler: async (ctx, { serverId }) => {
    const row = await previewRow(ctx, serverId)
    if (row?.state === "queued" && row.expiresAt <= Date.now()) await ctx.db.patch(row._id, { state: "failed", failure: "unanswered" })
} })
