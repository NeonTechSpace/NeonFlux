import type { RolesEvaluateResult } from "@neonflux/contracts/roles"
import type { RolesMemberContext } from "@neonflux/contracts/shared"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { desiredReference, dropUndesiredReferences, ensureOwner, grantEligibility, reserveRole, roleOwner, rolePolicy } from "./roleClaims.ts"
import { ownerReferences, rolesAcknowledgment } from "./rolesStore.ts"
import { evaluationKey, safeRole } from "./rolesDomain.ts"
import { currentXp, readLeveling, readProfile } from "./levelingStore.ts"
import { levelForXp } from "./levelingDomain.ts"
import { levelSource } from "./levelingWork.ts"
import { fail } from "./validation.ts"

export async function levelRemovalEligibility(ctx: MutationCtx, serverId: string, member: RolesMemberContext, roleId: string) {
    if (!member.botAuthorized || member.userId === member.botId) fail(403, "Bot role permission required")
    const policy = await rolePolicy(ctx, serverId)
    safeRole(serverId, roleId, member.roles, policy.staffRoleIds, false)
}
async function levelIntent(ctx: MutationCtx, serverId: string, userId: string, roleId: string) {
    const state = await readLeveling(ctx, serverId), profile = await readProfile(ctx, serverId, userId)
    if (!state || !profile) fail(409, "Leveling profile unavailable")
    const mapping = state.config.mappings.find(x => x.roleId === roleId)
    return { state, profile, desired: Boolean(mapping && levelForXp(currentXp(state.config, profile)) >= mapping.level) }
}
// Dispatch rechecks current score and mapping intent, so a later correction, reset or mapping change fences an older attempt
export async function levelAttemptFence(ctx: MutationCtx, serverId: string, attempt: Doc<"roleAttempts">) {
    const { state, desired } = await levelIntent(ctx, serverId, attempt.userId, attempt.roleId)
    if (attempt.action === "add" ? !desired || !state.config.enabled : desired) fail(409, "Leveling score intent changed")
}
export async function evaluateLevelRole(ctx: MutationCtx, identity: { serverId: string, sourceId: string, createdAt: number }, member: RolesMemberContext, operation: { type: "level-sync", roleId: string }): Promise<RolesEvaluateResult> {
    const now = Date.now(), { serverId, sourceId } = identity, roleId = operation.roleId
    if (Date.parse(member.joinedAt) > now + 1000) fail(400, "Invalid current membership observation")
    const { state, profile, desired } = await levelIntent(ctx, serverId, member.userId, roleId)
    if (profile.rewardDueAt === undefined || sourceId !== levelSource(profile, roleId)) fail(409, "Leveling role subject changed")
    const result = async (status: RolesEvaluateResult["status"], duplicate = false): Promise<RolesEvaluateResult> =>
        ({ duplicate, status, acknowledgment: await rolesAcknowledgment(ctx, serverId, member.userId, member.joinedAt, member.roleIds) })
    const previous = await ctx.db.query("roleAttempts").withIndex("by_source", q => q.eq("serverId", serverId).eq("sourceId", sourceId)).order("desc").first()
    // A success from an earlier membership epoch settles nothing, since a rejoined member may lack the role again
    if (previous && (previous.outcome !== "succeeded" || previous.joinedAt === member.joinedAt)) return result(previous.outcome === "succeeded" ? "unchanged" : "blocked", true)
    let owner = await roleOwner(ctx, serverId, member, roleId)
    const ref = owner ? (await ownerReferences(ctx, owner._id)).find(x => x.consumerKey === "level") : undefined
    if (owner) await ctx.db.patch(owner._id, { intentSourceId: sourceId })
    if (!desired) {
        if (!owner || !ref) return result("unchanged")
        await desiredReference(ctx, serverId, owner, "level", false, now)
        if (owner.status !== "idle") return result("blocked")
        if ((await ownerReferences(ctx, owner._id)).some(x => x.desired)) { await dropUndesiredReferences(ctx, owner._id); return result("unchanged") }
        if (owner.owned && member.roleIds.includes(roleId)) {
            await levelRemovalEligibility(ctx, serverId, member, roleId)
            const grant = await reserveRole(ctx, serverId, member, owner, "level", "remove", sourceId, now, evaluationKey(operation))
            return { ...await result("reserved"), grant }
        }
        await dropUndesiredReferences(ctx, owner._id)
        await ctx.db.patch(owner._id, { owned: false, protected: false, updatedAt: now })
        if (!(await ownerReferences(ctx, owner._id)).length) { await ctx.db.delete(owner._id) }
        return result("unchanged")
    }
    // Module disable preserves established references while pausing all new grants
    if (!state.config.enabled) return result("unchanged")
    await grantEligibility(ctx, serverId, member, "level", roleId)
    if (!owner) owner = await ensureOwner(ctx, serverId, member, roleId, now)
    await ctx.db.patch(owner._id, { intentSourceId: sourceId })
    await desiredReference(ctx, serverId, owner, "level", true, now)
    if (owner.status !== "idle") return result("blocked")
    if (member.roleIds.includes(roleId)) return result("unchanged")
    const grant = await reserveRole(ctx, serverId, member, owner, "level", "add", sourceId, now, evaluationKey(operation))
    return { ...await result("reserved"), grant }
}
