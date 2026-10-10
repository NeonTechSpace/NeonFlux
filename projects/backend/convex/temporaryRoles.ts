import { v } from "convex/values"
import type { RolesEvaluateResult } from "@neonflux/contracts/roles"
import type { RolesMemberContext } from "@neonflux/contracts/shared"
import { TemporaryRoleManageRequest, TemporaryRoleQueryRequest, TemporaryRoleWorkRequest, type TemporaryRoleDefault, type TemporaryRoleManageResult, type TemporaryRoleOperation,
    type TemporaryRoleQueryResult, type TemporaryRoleWorkResult } from "@neonflux/contracts/temporary-roles"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { actor, administrator } from "./moderationDomain.ts"
import { configurationRevision } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { desiredReference, dropUndesiredReferences, ensureOwner, grantEligibility, reserveRole, roleOwner, rolePolicy } from "./roleClaims.ts"
import { ownerReferences, rolesAcknowledgment, type RolesRead } from "./rolesStore.ts"
import { evaluationKey, memberContext, safeRole } from "./rolesDomain.ts"
import { publicTemporaryGrant, readTemporaryGrant, readTemporaryRoleSettings, TEMPORARY_ROLE_DEFAULTS, TEMPORARY_ROLE_KEY, TEMPORARY_ROLE_MEMBER_GRANTS, TEMPORARY_ROLE_RETRY_MS,
    temporaryRoleConfigurationOperation, temporarySource } from "./temporaryRolesStore.ts"
import { decode, fail, integer, requireReadMember, source } from "./validation.ts"

/** Due grants the worker settles per request */
const WORK_PAGE = 10

// Chat and dashboard saves share these rules. A role without either duration leaves the list
async function applyRoleDefaults(ctx: MutationCtx, serverId: string, op: Extract<TemporaryRoleOperation, { type: "role" }>) {
    if (op.roleId === serverId) fail(400, "The everyone role cannot be assigned")
    const row = await ctx.db.query("temporaryRoleSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique(), roles = [...(row?.roles ?? [])]
    const index = roles.findIndex(role => role.roleId === op.roleId), current: TemporaryRoleDefault = index < 0 ? { roleId: op.roleId } : roles[index]!
    const defaultSeconds = op.defaultSeconds === undefined ? current.defaultSeconds : op.defaultSeconds ?? undefined
    const maxSeconds = op.maxSeconds === undefined ? current.maxSeconds : op.maxSeconds ?? undefined
    if (defaultSeconds !== undefined && maxSeconds !== undefined && defaultSeconds > maxSeconds) fail(400, "The default duration is longer than the maximum")
    if (index >= 0) roles.splice(index, 1)
    if (defaultSeconds !== undefined || maxSeconds !== undefined) roles.push({ roleId: op.roleId, ...(defaultSeconds !== undefined ? { defaultSeconds } : {}), ...(maxSeconds !== undefined ? { maxSeconds } : {}) })
    if (roles.length > TEMPORARY_ROLE_DEFAULTS) fail(429, `At most ${TEMPORARY_ROLE_DEFAULTS} roles can have defaults`)
    if (row) await ctx.db.patch(row._id, { roles })
    else await ctx.db.insert("temporaryRoleSettings", { serverId, roles })
}
// Dashboard execute bumps the family revision after this
export async function applyTemporaryRoleConfiguration(ctx: MutationCtx, serverId: string, value: Record<string, unknown>) {
    await applyRoleDefaults(ctx, serverId, temporaryRoleConfigurationOperation(value))
    return {}
}

// Releases the temporary reference of an ended grant whose role needs no removal. Unresolved ownership stays until it is reconciled
async function releaseTemporaryReference(ctx: MutationCtx, serverId: string, member: Pick<RolesMemberContext, "userId" | "joinedAt">, roleId: string, now: number) {
    const owner = await roleOwner(ctx, serverId, member, roleId)
    if (!owner || owner.status !== "idle") return
    const refs = await ownerReferences(ctx, owner._id), ref = refs.find(x => x.consumerKey === TEMPORARY_ROLE_KEY)
    if (!ref) return
    await ctx.db.delete(ref._id)
    if (refs.some(x => x._id !== ref._id && x.desired)) return
    await dropUndesiredReferences(ctx, owner._id)
    await ctx.db.patch(owner._id, { owned: false, protected: false, updatedAt: now })
    if (!(await ownerReferences(ctx, owner._id)).length) { await ctx.db.delete(owner._id) }
}

/**
 * The role change a grant needs now. Before its end the member should hold the role, and after it NeonFlux removes the role, but only
 * when it added the role itself and no other feature still needs it. A grant whose role needs no removal is deleted here
 */
export async function evaluateTemporaryRole(ctx: MutationCtx, identity: { serverId: string, sourceId: string }, member: RolesMemberContext, operation: { type: "temporary", roleId: string }): Promise<RolesEvaluateResult> {
    const now = Date.now(), { serverId, sourceId } = identity, roleId = operation.roleId
    const row = await readTemporaryGrant(ctx, serverId, member.userId, roleId)
    if (!row || temporarySource(row) !== sourceId) fail(409, "Temporary role changed")
    if (row.joinedAt !== member.joinedAt) fail(409, "Temporary role belongs to an earlier membership")
    const result = async (status: RolesEvaluateResult["status"]): Promise<RolesEvaluateResult> =>
        ({ duplicate: false, status, acknowledgment: await rolesAcknowledgment(ctx, serverId, member.userId, member.joinedAt, member.roleIds) })
    let owner = await roleOwner(ctx, serverId, member, roleId)
    if (owner) await ctx.db.patch(owner._id, { intentSourceId: sourceId })
    if (now >= row.endsAt) {
        const refs = owner ? await ownerReferences(ctx, owner._id) : []
        if (owner && refs.some(x => x.consumerKey === TEMPORARY_ROLE_KEY)) {
            if (owner.status !== "idle") return result("blocked")
            if (owner.owned && member.roleIds.includes(roleId) && !refs.some(x => x.desired && x.consumerKey !== TEMPORARY_ROLE_KEY)) {
                await desiredReference(ctx, serverId, owner, TEMPORARY_ROLE_KEY, false, now)
                const grant = await reserveRole(ctx, serverId, member, owner, TEMPORARY_ROLE_KEY, "remove", sourceId, now, evaluationKey(operation))
                return { ...await result("reserved"), grant }
            }
            await releaseTemporaryReference(ctx, serverId, member, roleId, now)
        }
        await ctx.db.delete(row._id)
        return result("unchanged")
    }
    await grantEligibility(ctx, serverId, member, TEMPORARY_ROLE_KEY, roleId)
    if (!owner) owner = await ensureOwner(ctx, serverId, member, roleId, now)
    await ctx.db.patch(owner._id, { intentSourceId: sourceId })
    await desiredReference(ctx, serverId, owner, TEMPORARY_ROLE_KEY, true, now)
    if (owner.status !== "idle") return result("blocked")
    if (member.roleIds.includes(roleId)) return result("unchanged")
    const grant = await reserveRole(ctx, serverId, member, owner, TEMPORARY_ROLE_KEY, "add", sourceId, now, evaluationKey(operation))
    return { ...await result("reserved"), grant }
}
// Dispatch rechecks the grant, so a renewal, an early removal or a newer version fences an older attempt
export async function temporaryAttemptFence(ctx: RolesRead, serverId: string, attempt: Doc<"roleAttempts">) {
    if (attempt.consumerKey !== TEMPORARY_ROLE_KEY) return
    const row = await readTemporaryGrant(ctx, serverId, attempt.userId, attempt.roleId)
    if (!row || temporarySource(row) !== attempt.sourceId || row.joinedAt !== attempt.joinedAt || (Date.now() < row.endsAt) !== (attempt.action === "add")) fail(409, "Temporary role changed")
}

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<TemporaryRoleManageResult> => {
    const input = decode(TemporaryRoleManageRequest, request)
    const identity = source(input, Date.now()), serverId = identity.serverId, who = actor(input.actor), op = input.operation, now = Date.now()
    // Grants need Manage Roles and defaults need Manage Server, which the bot reads fresh. The owner and Administrators may do both
    if (!administrator(who) && !who.nativePermissionAuthorized) fail(403, op.type === "role" ? "Manage Server permission required" : "Manage Roles permission required", "ACTOR_PERMISSION")
    const policy = await rolePolicy(ctx, serverId)
    if (op.type === "role") {
        if (policy.defcon === 1) fail(403, "DEFCON restriction")
        await changeConfiguration(ctx, serverId, "temproles", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
            () => applyRoleDefaults(ctx, serverId, op))
        return { type: "settings", revision: await configurationRevision(ctx, serverId, "temproles"), settings: await readTemporaryRoleSettings(ctx, serverId) }
    }
    const row = await readTemporaryGrant(ctx, serverId, op.userId, op.roleId)
    const answer = async (id: Doc<"temporaryRoleGrants">["_id"]): Promise<TemporaryRoleManageResult> => ({ type: "grant", grant: publicTemporaryGrant((await ctx.db.get(id))!) })
    // Ending early works at every DEFCON level. The bot removes the role right after
    if (op.type === "remove") {
        if (!row) fail(404, "Temporary role not found")
        await ctx.db.patch(row._id, { endsAt: Math.min(row.endsAt, now), nextCheckAt: now, generation: row.generation + 1, updatedAt: now, problem: undefined })
        return answer(row._id)
    }
    if (policy.defcon !== 3) fail(403, "DEFCON restriction")
    const member = memberContext(input.context)
    if (member.userId !== op.userId) fail(409, "Member context mismatch")
    // The role must rank below both NeonFlux and the staff member and carry only ordinary member permissions
    safeRole(serverId, op.roleId, member.roles, policy.staffRoleIds, true)
    const defaults = (await readTemporaryRoleSettings(ctx, serverId)).roles.find(role => role.roleId === op.roleId)
    const seconds = op.durationSeconds ?? defaults?.defaultSeconds ?? fail(400, "Name a duration or set a default for this role")
    if (defaults?.maxSeconds !== undefined && seconds > defaults.maxSeconds) fail(400, "The duration is longer than this role's maximum")
    const endsAt = now + seconds * 1000
    if (op.type === "set") {
        if (!row || row.joinedAt !== member.joinedAt) fail(404, "Temporary role not found")
        await ctx.db.patch(row._id, { endsAt, nextCheckAt: endsAt, generation: row.generation + 1, updatedAt: now, grantedBy: who.userId, problem: undefined })
        return answer(row._id)
    }
    if (row?.joinedAt === member.joinedAt) fail(409, "Temporary role already active")
    // NeonFlux removes only roles it adds, so a role the member already holds cannot become temporary
    if (member.roleIds.includes(op.roleId)) fail(409, "Member already has that role")
    // A grant of an earlier membership ended when the member left
    if (row) await ctx.db.delete(row._id)
    if ((await ctx.db.query("temporaryRoleGrants").withIndex("by_member_role", q => q.eq("serverId", serverId).eq("userId", op.userId)).take(TEMPORARY_ROLE_MEMBER_GRANTS)).length >= TEMPORARY_ROLE_MEMBER_GRANTS)
        fail(429, `A member can hold at most ${TEMPORARY_ROLE_MEMBER_GRANTS} temporary roles`)
    const id = await ctx.db.insert("temporaryRoleGrants", { serverId, userId: op.userId, roleId: op.roleId, joinedAt: member.joinedAt, grantedBy: who.userId, generation: 1, endsAt, nextCheckAt: endsAt, createdAt: now, updatedAt: now })
    // The same checks the role grant repeats, so a refused grant leaves no row behind
    await grantEligibility(ctx, serverId, member, TEMPORARY_ROLE_KEY, op.roleId)
    return answer(id)
} })

export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<TemporaryRoleQueryResult> => {
    const input = decode(TemporaryRoleQueryRequest, request), serverId = input.serverId, who = actor(input.actor), op = input.operation
    if (!administrator(who) && !who.nativePermissionAuthorized) fail(403, "Manage Roles permission required", "ACTOR_PERMISSION")
    if (op.type === "settings") return { type: "settings", revision: await configurationRevision(ctx, serverId, "temproles"), settings: await readTemporaryRoleSettings(ctx, serverId) }
    if (op.userId !== undefined) {
        const userId = op.userId
        const rows = await ctx.db.query("temporaryRoleGrants").withIndex("by_member_role", q => q.eq("serverId", serverId).eq("userId", userId)).take(TEMPORARY_ROLE_MEMBER_GRANTS)
        return { type: "grants", grants: rows.sort((a, b) => a.endsAt - b.endsAt).map(publicTemporaryGrant) }
    }
    const page = await ctx.db.query("temporaryRoleGrants").withIndex("by_server_end", q => q.eq("serverId", serverId)).paginate({ numItems: 10, cursor: op.cursor ?? null })
    return { type: "grants", grants: page.page.map(publicTemporaryGrant), ...(page.isDone ? {} : { nextCursor: page.continueCursor }) }
} })

export const work = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<TemporaryRoleWorkResult> => {
    const { serverId, operation: op } = decode(TemporaryRoleWorkRequest, request), now = Date.now()
    if (op.type === "list") {
        const rows = await ctx.db.query("temporaryRoleGrants").withIndex("by_server_due", q => q.eq("serverId", serverId).lte("nextCheckAt", now)).take(WORK_PAGE)
        return { type: "grants", grants: rows.map(publicTemporaryGrant) }
    }
    const row = await readTemporaryGrant(ctx, serverId, op.userId, op.roleId)
    // A grant that changed since the bot read it waits for its own next check
    if (!row || temporarySource(row) !== op.sourceId) return { type: "recorded", recorded: false }
    if (op.type === "problem") {
        await ctx.db.patch(row._id, { problem: op.problem, nextCheckAt: Math.max(row.endsAt, now + TEMPORARY_ROLE_RETRY_MS) })
        return { type: "recorded", recorded: true }
    }
    if (op.reason === "member") {
        // A membership that ended took the role with it, and rejoining does not restore it
        requireReadMember(op, row.userId)
        integer(op.observedAt, now - 60000, now + 1000)
        if (op.currentJoinedAt === row.joinedAt) fail(409, "Current membership requires role evaluation")
    }
    await releaseTemporaryReference(ctx, serverId, { userId: row.userId, joinedAt: row.joinedAt }, row.roleId, now)
    await ctx.db.delete(row._id)
    return { type: "recorded", recorded: true }
} })
