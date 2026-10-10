import { TemporaryRoleOperation, type TemporaryRoleGrant, type TemporaryRoleSettings } from "@neonflux/contracts/temporary-roles"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { decode, fail } from "./validation.ts"

export { TEMPORARY_ROLE_DEFAULTS, TEMPORARY_ROLE_MEMBER_GRANTS } from "@neonflux/contracts/temporary-roles"
type Read = Pick<QueryCtx | MutationCtx, "db">
/** The consumer key of temporary roles in the role ownership references */
export const TEMPORARY_ROLE_KEY = "temporary"
/** A grant with a problem is checked again this long after the problem was recorded, or at its end time when that is later */
export const TEMPORARY_ROLE_RETRY_MS = 600000

/** The dashboard sets both durations of a role at once */
export function temporaryRoleConfigurationOperation(value: unknown): DashboardConfigurationOperationMap["temproles"] {
    const op = decode(TemporaryRoleOperation, value)
    if (op.type !== "role" || op.defaultSeconds === undefined || op.maxSeconds === undefined) fail(400, "Unsupported configuration operation")
    return { type: "role", roleId: op.roleId, defaultSeconds: op.defaultSeconds, maxSeconds: op.maxSeconds }
}
/** The role source of one version of a grant. A changed grant gets a new source, which fences role attempts of the older version */
export const temporarySource = (row: Doc<"temporaryRoleGrants">) => `temp_${row._id}_${row.generation}`
export function readTemporaryGrant(ctx: Read, serverId: string, userId: string, roleId: string) {
    return ctx.db.query("temporaryRoleGrants").withIndex("by_member_role", q => q.eq("serverId", serverId).eq("userId", userId).eq("roleId", roleId)).unique()
}
export async function readTemporaryRoleSettings(ctx: Read, serverId: string): Promise<TemporaryRoleSettings> {
    const row = await ctx.db.query("temporaryRoleSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    return { roles: row?.roles ?? [] }
}
export function publicTemporaryGrant(row: Doc<"temporaryRoleGrants">): TemporaryRoleGrant {
    return { grantId: row._id, userId: row.userId, roleId: row.roleId, joinedAt: row.joinedAt, endsAt: row.endsAt, grantedBy: row.grantedBy, createdAt: row.createdAt,
        updatedAt: row.updatedAt, sourceId: temporarySource(row), ...(row.problem ? { problem: row.problem } : {}) }
}
/** Whether the member's current membership should hold the role now */
export async function temporaryRoleDesired(ctx: Read, serverId: string, member: { userId: string, joinedAt: string }, roleId: string, now: number) {
    const row = await readTemporaryGrant(ctx, serverId, member.userId, roleId)
    return Boolean(row && row.joinedAt === member.joinedAt && now < row.endsAt)
}
