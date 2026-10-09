import type { RolePickerMemberOperation, RolesMemberContext } from "../contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import { participationAvailability, roleOwner } from "./roleClaims.ts"
import { ownerReferences, type RolesRead } from "./rolesStore.ts"
import { pickerKey } from "./rolePickerDomain.ts"
import { pickerJobFence, pickerMenu } from "./rolePickerStore.ts"
import { fail } from "./validation.ts"

// A single-choice swap releases only roles NeonFlux added for this member that no other feature still needs
export async function exclusiveConflict(ctx: RolesRead, serverId: string, member: Pick<RolesMemberContext, "userId" | "joinedAt" | "roleIds">, key: string, roleIds: readonly string[]) {
    for (const roleId of roleIds.filter(id => member.roleIds.includes(id))) {
        const owner = await roleOwner(ctx, serverId, member, roleId), refs = owner ? await ownerReferences(ctx, owner._id) : []
        if (!owner?.owned || owner.status !== "idle" || refs.some(ref => ref.desired && ref.consumerKey !== key)) return true
    }
    return false
}
// A pick follows the panel choice rules. The member's queued request fixes the menu, role and direction
export async function pickIntent(ctx: RolesRead, identity: { serverId: string, sourceId: string }, member: RolesMemberContext, op: { jobId: string, menu: string, roleId: string, selected: boolean }) {
    const job = await pickerJobFence(ctx, identity.serverId, op.jobId, member.userId), intent = job.operation as RolePickerMemberOperation
    if (identity.sourceId !== `picker_${job._id}` || intent.type === "lookup" || intent.menu !== op.menu || intent.roleId !== op.roleId || (intent.type === "claim") !== op.selected) fail(409, "Role picker request changed")
    await participationAvailability(ctx, identity.serverId, member)
    const menu = await pickerMenu(ctx, identity.serverId, member, op.menu, op.roleId), key = pickerKey(menu.name), swap = op.selected && menu.mode === "single"
    if (swap && await exclusiveConflict(ctx, identity.serverId, member, key, menu.roleIds.filter(id => id !== op.roleId))) fail(409, "Conflicting role is not exclusively owned")
    return { key, desiredRoleIds: op.selected ? [op.roleId] : [], consideredRoleIds: swap ? [...menu.roleIds] : [op.roleId] }
}
// Dispatch rechecks the request and its sign-in grant before any native role write
export async function pickerAttemptFence(ctx: RolesRead, serverId: string, attempt: Doc<"roleAttempts">) {
    if (attempt.sourceId.startsWith("picker_")) await pickerJobFence(ctx, serverId, attempt.sourceId.slice(7), attempt.userId)
}
export async function pickerRemovalEligibility(ctx: RolesRead, serverId: string, member: RolesMemberContext, consumerKey: string, roleId: string) {
    const policy = await participationAvailability(ctx, serverId, member)
    await pickerMenu(ctx, serverId, member, consumerKey.slice(7), roleId)
    return policy
}
