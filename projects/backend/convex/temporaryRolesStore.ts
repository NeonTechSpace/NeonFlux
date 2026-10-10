import type { TemporaryRoleGrant, TemporaryRoleSettings } from "../contracts.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { shape } from "./publishingDomain.ts"
import { fail, requireId } from "./validation.ts"

type Read = Pick<QueryCtx | MutationCtx, "db">
/** The consumer key of temporary roles in the role ownership references */
export const TEMPORARY_ROLE_KEY = "temporary"
export const TEMPORARY_ROLE_MIN_SECONDS = 60
export const TEMPORARY_ROLE_MAX_SECONDS = 365 * 86400
/** A grant with a problem is checked again this long after the problem was recorded, or at its end time when that is later */
export const TEMPORARY_ROLE_RETRY_MS = 600000
/** Roles with their own defaults per server */
export const TEMPORARY_ROLE_DEFAULTS = 100
/** Temporary roles one member holds at once */
export const TEMPORARY_ROLE_MEMBER_GRANTS = 25

export function temporarySeconds(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < TEMPORARY_ROLE_MIN_SECONDS || value > TEMPORARY_ROLE_MAX_SECONDS) fail(400, "Durations run from 1 minute to 365 days")
    return value
}
export const optionalSeconds = (value: unknown) => value === null ? null : temporarySeconds(value)
/** The dashboard sets both durations of a role at once */
export function temporaryRoleConfigurationOperation(value: unknown): DashboardConfigurationOperationMap["temproles"] {
    const input = shape(value, ["type", "roleId", "defaultSeconds", "maxSeconds"], ["type", "roleId", "defaultSeconds", "maxSeconds"])
    if (input.type !== "role") fail(400, "Unsupported configuration operation")
    return { type: "role", roleId: requireId(input.roleId), defaultSeconds: optionalSeconds(input.defaultSeconds), maxSeconds: optionalSeconds(input.maxSeconds) }
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
