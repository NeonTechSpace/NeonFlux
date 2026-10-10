import { v } from "convex/values"
import type { RolesManageResult, RolesQueryResult, RolesMemberQueryResult, RolesSettings } from "../contracts.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { actor, administrator } from "./moderationDomain.ts"
import { shape } from "./publishingDomain.ts"
import { autoroleIds, consumerKey, defaultRolesSettings, epoch, mappings, memberContext, reservations, roleSnapshots, ROLES_DAY, ROLES_RETENTION, safeRole } from "./rolesDomain.ts"
import { rolePolicy } from "./roleClaims.ts"
import { ownerReferences, publicRoleAttempt, publicRoleClaim, publicRolePanel, publicWithdrawal, readRolesSettings, roleAttempt, rolePanel, rolesAcknowledgment, rolesAdmin, rolesReceipt, rolesState, roleWithdrawal } from "./rolesStore.ts"
import { cursor, fail, object, requireId, requireServer, bool, fresh, ids, integer, name, requireReadMember, source } from "./validation.ts"
import { auditedChange, type AuditActor } from "./auditLog.ts"

async function configReferences(ctx: MutationCtx, serverId: string, key: string, roleIds: string[], now: number, postNo?: number) {
    const old = await ctx.db.query("roleReferences").withIndex("by_consumer", q => q.eq("serverId", serverId).eq("consumerKey", key).eq("configuration", true)).take(1001)
    for (const roleId of roleIds) {
        const existing = old.find(x => x.roleId === roleId)
        if (existing) { if (postNo !== undefined) await ctx.db.patch(existing._id, { postNo }); continue }
        await ctx.db.insert("roleReferences", { serverId, consumerKey: key, roleId, configuration: true, desired: true, createdAt: now, ...(postNo !== undefined ? { postNo } : {}) })
    }
}
async function withdrawBatch(ctx: MutationCtx, job: Doc<"roleWithdrawals">, now: number) {
    await ctx.db.patch(job._id, { step: job.step + 1 })
    if (job.status === "complete") return publicWithdrawal(ctx, (await ctx.db.get(job._id))!)
    const panelName = job.consumerKey.startsWith("panel:") ? job.consumerKey.split(":")[1]! : undefined, revision = Number(job.consumerKey.split(":").at(-1))
    if (panelName) {
        const acknowledgments = await ctx.db.query("roleAcknowledgments").withIndex("by_panel", q => q.eq("serverId", job.serverId).eq("panelName", panelName).eq("rulesRevision", revision)).take(10)
        for (const ack of acknowledgments) { await ctx.db.delete(ack._id) }
    }
    const refs = await ctx.db.query("roleReferences").withIndex("by_consumer", q => q.eq("serverId", job.serverId).eq("consumerKey", job.consumerKey).eq("configuration", false)).take(10)
    let blocked = false
    for (const ref of refs) {
        const owner = ref.ownershipId ? await ctx.db.get(ref.ownershipId) : null
        if (!owner || owner.status === "idle" && !owner.owned) {
            await ctx.db.delete(ref._id)
            if (owner && !(await ownerReferences(ctx, owner._id)).length) { await ctx.db.delete(owner._id) }
        } else { await ctx.db.patch(ref._id, { desired: false }); if (owner.status !== "idle") blocked = true }
    }
    const remaining = await ctx.db.query("roleReferences").withIndex("by_consumer", q => q.eq("serverId", job.serverId).eq("consumerKey", job.consumerKey).eq("configuration", false)).first()
    const remainingAcknowledgment = panelName ? await ctx.db.query("roleAcknowledgments").withIndex("by_panel", q => q.eq("serverId", job.serverId).eq("panelName", panelName).eq("rulesRevision", revision)).first() : null
    if (!remaining && !remainingAcknowledgment) {
        const configRefs = await ctx.db.query("roleReferences").withIndex("by_consumer", q => q.eq("serverId", job.serverId).eq("consumerKey", job.consumerKey).eq("configuration", true)).take(21)
        for (const ref of configRefs) { await ctx.db.delete(ref._id) }
        if (await ctx.db.query("roleReferences").withIndex("by_consumer", q => q.eq("serverId", job.serverId).eq("consumerKey", job.consumerKey).eq("configuration", true)).first()) {
            await ctx.db.patch(job._id, { status: "pending" })
            return publicWithdrawal(ctx, (await ctx.db.get(job._id))!)
        }
        if (job.consumerKey.startsWith("panel:")) {
            const panelName = job.consumerKey.split(":")[1]!, revision = Number(job.consumerKey.split(":")[2])
            const panel = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", job.serverId).eq("name", panelName)).unique()
            if (panel && (job.deletePanel || panel.published?.revision === revision)) {
                if (job.deletePanel) {
                    // A different retained revision needs its own explicit withdrawal first
                    const prefix = `panel:${panelName}:`
                    const retained = await ctx.db.query("roleReferences").withIndex("by_server_configuration_consumer", q => q.eq("serverId", job.serverId).eq("configuration", true).gte("consumerKey", prefix).lt("consumerKey", `${prefix}\uffff`)).first()
                    if (retained) fail(409, "Other panel revisions retained")
                    await ctx.db.delete(panel._id)
                } else await ctx.db.patch(panel._id, { published: undefined, withdrawing: false })
            }
        }
        await ctx.db.patch(job._id, { status: "complete", expiresAt: now + ROLES_DAY })
    } else await ctx.db.patch(job._id, { status: blocked ? "blocked" : "pending" })
    return publicWithdrawal(ctx, (await ctx.db.get(job._id))!)
}
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolesManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "operation"], ["serverId", "messageId", "createdAt", "actor", "operation"])
    const now = Date.now(), identity = source(input, now), op = object(input.operation)
    const critical = String(op.type).startsWith("withdraw") || op.type === "autorole-withdraw" || op.type === "settings" && Object.entries(object(op.patch)).every(([key, value]) => ["panelsEnabled", "verificationEnabled", "autoroleEnabled"].includes(key) && value === false)
    const who = await rolesAdmin(ctx, identity.serverId, input.actor, critical)
    return changeRoles(ctx, identity, { userId: who.userId, source: "command" }, op, now)
} })

// Chat and the website change role settings and panels here, which records each change in the audit log. Withdrawal steps the
// bot runs on its own and the binding of a panel the website just published are part of an earlier recorded change
const AUDITED_ROLE_OPERATIONS = ["settings", "panel-create", "panel-update", "panel-bind", "withdraw", "autorole-withdraw"]
export function changeRoles(ctx: MutationCtx, identity: Parameters<typeof applyRoleManagement>[1], actor: AuditActor, op: Record<string, unknown>, now: number) {
    const apply = () => applyRoleManagement(ctx, identity, op, now)
    if (!AUDITED_ROLE_OPERATIONS.includes(String(op.type))) return apply()
    return auditedChange(ctx, identity.serverId, actor, "roles", op, async () => ({ settings: (await readRolesSettings(ctx, identity.serverId))?.config ?? defaultRolesSettings(),
        panels: await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", identity.serverId)).take(52) }), apply)
}

export async function applyRoleManagement(ctx: MutationCtx, identity: { serverId: string, messageId: string } | {serverId:string,jobId:string,phase?:"bind"}, op: Record<string, unknown>, now: number): Promise<RolesManageResult> {
    const sourceKey = "jobId" in identity ? `dashboard:${identity.jobId}:${identity.phase ?? "configure"}` : identity.messageId
    const receiptKey = op.type === "withdraw-departed" ? `${sourceKey}:departed:${String(op.withdrawalId)}:${String(op.userId)}:${String(op.joinedAt)}` : op.type === "withdraw-next" ? `${sourceKey}:next:${String(op.withdrawalId)}:${String(op.expectedStep)}` : sourceKey
    if (!await rolesReceipt(ctx, identity.serverId, receiptKey, now)) return { duplicate: true }
    const current = await rolesState(ctx, identity.serverId), policy = await rolePolicy(ctx, identity.serverId)
    if (["settings", "panel-create", "panel-update", "panel-bind", "withdraw", "autorole-withdraw", "withdraw-next", "withdraw-departed"].includes(String(op.type))) {
        const revision = current.dashboardRevision ?? 0
        if (revision >= Number.MAX_SAFE_INTEGER) fail(429, "Settings revision exhausted")
        await ctx.db.patch(current._id, { dashboardRevision: revision + 1 })
    }
    if (op.type === "settings") {
        shape(op, ["type", "patch", "roles", "expectedRevision"], ["type", "patch"])
        const patch = shape(op.patch, ["panelsEnabled", "verificationEnabled", "advancedVerificationEnabled", "autoroleEnabled", "humansOnly", "autoroleIds", "reservations"])
        if (!Object.keys(patch).length) fail(400, "Invalid role settings")
        // Chat edits of whole role lists name the revision they read, so a concurrent edit is never overwritten
        if (op.expectedRevision !== undefined && op.expectedRevision !== current.config.revision) fail(409, "Role settings changed")
        const next: RolesSettings = structuredClone(current.config)
        for (const [key, value] of Object.entries(patch)) {
            if (key === "autoroleIds") next.autoroleIds = ids(value)
            else if (key === "reservations") next.reservations = reservations(value)
            else (next as unknown as Record<string, unknown>)[key] = bool(value)
        }
        const changedRoles = patch.autoroleIds !== undefined || patch.reservations !== undefined
        if (changedRoles) {
            if (next.revision >= Number.MAX_SAFE_INTEGER) fail(429, "Autorole revision exhausted")
            next.revision++
        }
        const configured = autoroleIds(next)
        if (configured.length > 1000) fail(400, "Autorole configuration supports at most 1000 distinct roles")
        if (changedRoles || patch.autoroleEnabled === true) {
            const observed = roleSnapshots(op.roles)
            for (const roleId of configured) safeRole(identity.serverId, roleId, observed, policy.staffRoleIds, true)
        }
        await ctx.db.patch(current._id, { config: next })
        if (changedRoles) await configReferences(ctx, identity.serverId, `autorole:${next.revision}`, configured, now)
        return { duplicate: false, type: "settings", settings: next }
    }
    if (op.type === "panel-create") {
        shape(op, ["type", "name", "kind", "mappings", "roles", "exclusive"], ["type", "name", "kind"])
        const panelName = name(op.name), kind = op.kind
        if (kind !== "reaction" && kind !== "verification") fail(400, "Invalid panel kind")
        if (await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", identity.serverId).eq("name", panelName)).unique()) fail(409, "Panel already exists")
        if ((await ctx.db.query("rolePanels").withIndex("by_server_kind", q => q.eq("serverId", identity.serverId).eq("kind", kind)).take(kind === "reaction" ? 51 : 2)).length >= (kind === "reaction" ? 50 : 1)) fail(429, "Panel capacity reached")
        const maps = op.mappings === undefined ? [] : mappings(op.mappings)
        if (kind === "verification" && maps.length > 1) fail(400, "Verification requires one access role")
        if (maps.length) { const observed = roleSnapshots(op.roles); for (const map of maps) safeRole(identity.serverId, map.roleId, observed, policy.staffRoleIds, true) }
        if (current.nextPanelRevision >= Number.MAX_SAFE_INTEGER) fail(429, "Panel revision sequence exhausted")
        const revision = current.nextPanelRevision
        await ctx.db.patch(current._id, { nextPanelRevision: revision + 1 })
        const id = await ctx.db.insert("rolePanels", { serverId: identity.serverId, name: panelName, kind, revision, enabled: true, exclusive: op.exclusive === undefined ? false : bool(op.exclusive), mappings: maps, withdrawing: false })
        await configReferences(ctx, identity.serverId, consumerKey(panelName, revision), maps.map(x => x.roleId), now)
        return { duplicate: false, type: "panel", panel: publicRolePanel((await ctx.db.get(id))!) }
    }
    if (op.type === "panel-update") {
        shape(op, ["type", "name", "expectedRevision", "patch", "roles"], ["type", "name", "expectedRevision", "patch"])
        const panel = await rolePanel(ctx, identity.serverId, op.name, op.expectedRevision), patch = shape(op.patch, ["enabled", "exclusive", "mappings"])
        if (!Object.keys(patch).length || panel.withdrawing) fail(409, "Panel cannot be changed")
        const maps = patch.mappings === undefined ? panel.mappings : mappings(patch.mappings)
        if (panel.kind === "verification" && maps.length > 1) fail(400, "Verification requires one access role")
        if (patch.mappings !== undefined || patch.enabled === true) { const observed = roleSnapshots(op.roles); for (const map of maps) safeRole(identity.serverId, map.roleId, observed, policy.staffRoleIds, true) }
        const semanticChange = patch.mappings !== undefined || patch.exclusive !== undefined
        if (semanticChange && current.nextPanelRevision >= Number.MAX_SAFE_INTEGER) fail(429, "Panel revision sequence exhausted")
        const revision = semanticChange ? current.nextPanelRevision : panel.revision
        if (semanticChange) await ctx.db.patch(current._id, { nextPanelRevision: revision + 1 })
        await ctx.db.patch(panel._id, { mappings: maps, revision, enabled: patch.enabled === undefined ? panel.enabled : bool(patch.enabled), exclusive: patch.exclusive === undefined ? panel.exclusive : bool(patch.exclusive) })
        await configReferences(ctx, identity.serverId, consumerKey(panel.name, revision), maps.map(x => x.roleId), now)
        return { duplicate: false, type: "panel", panel: publicRolePanel((await ctx.db.get(panel._id))!) }
    }
    if (op.type === "panel-bind") {
        shape(op, ["type", "name", "expectedRevision", "postNo", "expectedPostGeneration"], ["type", "name", "expectedRevision", "postNo", "expectedPostGeneration"])
        const panel = await rolePanel(ctx, identity.serverId, op.name, op.expectedRevision), postNo = integer(op.postNo, 1, Number.MAX_SAFE_INTEGER)
        if (!panel.mappings.length || panel.withdrawing) fail(409, "Panel is not publishable")
        const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", identity.serverId).eq("postNo", postNo)).unique()
        if (!post || post.generation !== integer(op.expectedPostGeneration, 1, Number.MAX_SAFE_INTEGER) || post.outcome !== "sent" || !post.messageId || !post.confirmedCanonicalContent || !post.attemptId) fail(409, "Published panel post is not confirmed")
        const attempt = await ctx.db.get(post.attemptId)
        if (!attempt || attempt.unresolved || attempt.action !== "send" || post.generation !== 1) fail(409, "Panel requires a fresh published message")
        const key = consumerKey(panel.name, panel.revision)
        const bindings = await ctx.db.query("roleReferences").withIndex("by_server_post", q => q.eq("serverId", identity.serverId).eq("postNo", postNo)).take(21)
        if (bindings.some(x => x.consumerKey !== key) || panel.published && panel.published.messageId === post.messageId && panel.published.revision !== panel.revision) fail(409, "Old panel message cannot be reinterpreted")
        if (panel.published?.revision === panel.revision && panel.published.messageId !== post.messageId) fail(409, "Panel revision already published")
        const published = { revision: panel.revision, publishedAt: panel.published?.messageId === post.messageId ? panel.published.publishedAt : now, postNo, postGeneration: post.generation, channelId: post.channelId, messageId: post.messageId, botId: post.botId, content: post.confirmedCanonicalContent, mappings: panel.mappings, exclusive: panel.exclusive }
        await ctx.db.patch(panel._id, { published })
        await configReferences(ctx, identity.serverId, key, panel.mappings.map(x => x.roleId), now, postNo)
        return { duplicate: false, type: "panel", panel: publicRolePanel((await ctx.db.get(panel._id))!) }
    }
    if (op.type === "withdraw" || op.type === "autorole-withdraw") {
        shape(op, op.type === "withdraw" ? ["type", "name", "revision", "deletePanel"] : ["type", "revision"], op.type === "withdraw" ? ["type", "name", "revision"] : ["type", "revision"])
        const revision = integer(op.revision, 1, Number.MAX_SAFE_INTEGER), panel = op.type === "withdraw" ? await rolePanel(ctx, identity.serverId, op.name) : null
        if (panel && revision > panel.revision || !panel && revision > current.config.revision) fail(400, "Invalid withdrawal revision")
        const key = panel ? consumerKey(panel.name, revision) : `autorole:${revision}`
        if (!panel && revision === current.config.revision && autoroleIds(current.config).length) fail(409, "Remove autorole configuration first")
        const existing = await ctx.db.query("roleWithdrawals").withIndex("by_consumer", q => q.eq("serverId", identity.serverId).eq("consumerKey", key)).unique()
        const deletePanel = op.deletePanel === undefined ? false : bool(op.deletePanel)
        if (panel && (revision === panel.published?.revision || deletePanel)) await ctx.db.patch(panel._id, { withdrawing: true, enabled: false })
        let job = existing
        if (!job) {
            if ((await ctx.db.query("roleWithdrawals").withIndex("by_consumer", q => q.eq("serverId", identity.serverId)).take(101)).length >= 100) fail(429, "Withdrawal capacity reached")
            const id = await ctx.db.insert("roleWithdrawals", { serverId: identity.serverId, consumerKey: key, step: 0, status: "pending", deletePanel, createdAt: now })
            job = (await ctx.db.get(id))!
        } else if (deletePanel && !job.deletePanel) { await ctx.db.patch(job._id, { deletePanel: true }); job = (await ctx.db.get(job._id))! }
        return { duplicate: false, type: "withdrawal", withdrawal: await withdrawBatch(ctx, job, now) }
    }
    if (op.type === "withdraw-next") {
        shape(op, ["type", "withdrawalId", "expectedStep"], ["type", "withdrawalId", "expectedStep"])
        const job = await roleWithdrawal(ctx, identity.serverId, op.withdrawalId)
        if (job.step !== integer(op.expectedStep, 0, Number.MAX_SAFE_INTEGER)) fail(409, "Withdrawal step changed")
        return { duplicate: false, type: "withdrawal", withdrawal: await withdrawBatch(ctx, job, now) }
    }
    if (op.type === "withdraw-departed") {
        shape(op, ["type", "withdrawalId", "userId", "joinedAt", "currentJoinedAt", "observedAt", "memberUserId"], ["type", "withdrawalId", "userId", "joinedAt", "currentJoinedAt", "observedAt"])
        const job = await roleWithdrawal(ctx, identity.serverId, op.withdrawalId), userId = requireId(op.userId), joinedAt = epoch(op.joinedAt)
        requireReadMember(op, userId)
        const observedAt = integer(op.observedAt, now - 60000, now + 1000)
        if (op.currentJoinedAt !== null && epoch(op.currentJoinedAt) === joinedAt) fail(409, "Membership epoch still current")
        const refs = await ctx.db.query("roleReferences").withIndex("by_consumer", q => q.eq("serverId", identity.serverId).eq("consumerKey", job.consumerKey).eq("configuration", false)).take(11)
        for (const ref of refs) {
            const owner = ref.ownershipId ? await ctx.db.get(ref.ownershipId) : null
            if (!owner || owner.userId !== userId || owner.joinedAt !== joinedAt) continue
            const attempt = owner.attemptId ? await ctx.db.get(owner.attemptId) : null
            if (owner.status !== "idle" || attempt?.outcome === "pending" || attempt?.outcome === "uncertain" && attempt.observationAt === undefined) fail(409, "Unresolved role ownership preserved")
            for (const old of await ownerReferences(ctx, owner._id)) { await ctx.db.delete(old._id) }
            await ctx.db.delete(owner._id)
            if (attempt) await ctx.db.patch(attempt._id, { observationAt: observedAt, expiresAt: now + ROLES_RETENTION })
        }
        const acknowledgment = await ctx.db.query("roleAcknowledgments").withIndex("by_server_member", q => q.eq("serverId", identity.serverId).eq("userId", userId).eq("joinedAt", joinedAt)).unique()
        if (acknowledgment && job.consumerKey === consumerKey(acknowledgment.panelName, acknowledgment.rulesRevision)) { await ctx.db.delete(acknowledgment._id) }
        return { duplicate: false, type: "withdrawal", withdrawal: await withdrawBatch(ctx, job, now) }
    }
    fail(400, "Invalid role operation")
}

export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolesQueryResult> => {
    const input = shape(request, ["serverId", "actor", "operation"], ["serverId", "actor", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const op = object(input.operation)
    const who = actor(input.actor)
    if (op.type === "claim-list" && who.userId === op.userId && !administrator(who)) { if ((await rolePolicy(ctx, serverId)).defcon !== 3) fail(403, "DEFCON restriction") }
    else await rolesAdmin(ctx, serverId, input.actor, true)
    if (op.type === "settings") { shape(op, ["type"], ["type"]); return { type: "settings", settings: (await readRolesSettings(ctx, serverId))?.config ?? defaultRolesSettings() } }
    if (op.type === "panel-show") { shape(op, ["type", "name"], ["type", "name"]); return { type: "panel", panel: publicRolePanel(await rolePanel(ctx, serverId, op.name)) } }
    if (op.type === "panel-list") {
        shape(op, ["type", "page"], ["type"]); const page = op.page === undefined ? 1 : integer(op.page, 1, 6)
        const rows = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId)).take(52)
        return { type: "panels", panels: rows.slice((page - 1) * 10, page * 10).map(publicRolePanel), page, totalPages: Math.max(1, Math.ceil(rows.length / 10)) }
    }
    if (op.type === "claim-list") {
        shape(op, ["type", "userId", "joinedAt", "cursor"], ["type", "userId", "joinedAt"])
        if (op.cursor !== undefined && typeof op.cursor !== "string") fail(400, "Invalid claim cursor")
        const userId = requireId(op.userId), joinedAt = epoch(op.joinedAt)
        const page = await ctx.db.query("roleOwnership").withIndex("by_server_member_role", q => q.eq("serverId", serverId).eq("userId", userId).eq("joinedAt", joinedAt)).paginate({ numItems: 10, cursor: cursor(op.cursor) })
        return { type: "claims", claims: await Promise.all(page.page.map(row => publicRoleClaim(ctx, row))), ...(page.isDone ? {} : { nextCursor: page.continueCursor }) }
    }
    if (op.type === "attempt-show") { shape(op, ["type", "attemptId"], ["type", "attemptId"]); return { type: "attempt", attempt: publicRoleAttempt(await roleAttempt(ctx, serverId, op.attemptId)) } }
    if (op.type === "configuration-list") {
        shape(op, ["type", "name", "cursor"], ["type"])
        if (op.cursor !== undefined && typeof op.cursor !== "string") fail(400, "Invalid configuration cursor")
        const prefix = op.name === undefined ? undefined : `panel:${name(op.name)}:`
        const rows = ctx.db.query("roleReferences").withIndex("by_server_configuration_consumer", q => prefix === undefined ? q.eq("serverId", serverId).eq("configuration", true) : q.eq("serverId", serverId).eq("configuration", true).gte("consumerKey", prefix).lt("consumerKey", `${prefix}\uffff`))
        const page = await rows.paginate({ numItems: 10, cursor: cursor(op.cursor) })
        return { type: "configurations", references: page.page.map(row => ({ consumerKey: row.consumerKey, roleId: row.roleId, ...(row.postNo !== undefined ? { postNo: row.postNo } : {}) })), ...(page.isDone ? {} : { nextCursor: page.continueCursor }) }
    }
    if (op.type === "withdrawal-show") {
        shape(op, ["type", "withdrawalId", "cursor"], ["type", "withdrawalId"])
        if (op.cursor !== undefined && typeof op.cursor !== "string") fail(400, "Invalid withdrawal cursor")
        return { type: "withdrawal", withdrawal: await publicWithdrawal(ctx, await roleWithdrawal(ctx, serverId, op.withdrawalId), cursor(op.cursor)) }
    }
    fail(400, "Invalid role query")
} })
export const memberQuery = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolesMemberQueryResult> => {
    const input = shape(request, ["serverId", "context"], ["serverId", "context"]), serverId = requireId(input.serverId); requireServer(serverId)
    const member = memberContext(input.context), panels = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId)).take(52)
    return { settings: (await readRolesSettings(ctx, serverId))?.config ?? defaultRolesSettings(), panels: panels.map(publicRolePanel), acknowledgment: await rolesAcknowledgment(ctx, serverId, member.userId, member.joinedAt, member.roleIds) }
} })
export const policy = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId"], ["serverId"]), serverId = requireId(input.serverId); requireServer(serverId)
    return { settings: (await readRolesSettings(ctx, serverId))?.config ?? defaultRolesSettings() }
} })
