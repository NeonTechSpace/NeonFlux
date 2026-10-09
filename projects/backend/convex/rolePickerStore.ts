import type { RolePickerJob, RolePickerMemberOperation, RolePickerRoleDisplay, RolePickerSettings, RolesMemberContext } from "../contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { memberAllowed } from "./memberAccess.ts"
import { ROLE_PICKER_FEATURE, ROLE_PICKER_MEMBER_FAMILY, ROLE_PICKER_SNAPSHOT_MS } from "./rolePickerDomain.ts"
import { fail } from "./validation.ts"

type Read = Pick<QueryCtx, "db">
export const defaultRolePicker = (): RolePickerSettings => ({ enabled: false, menus: [] })
export function rolePickerRow(ctx: Read, serverId: string) {
    return ctx.db.query("rolePickerSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
}
export async function readRolePicker(ctx: Read, serverId: string): Promise<RolePickerSettings> {
    const row = await rolePickerRow(ctx, serverId)
    return row ? { enabled: row.enabled, menus: row.menus } : defaultRolePicker()
}
export function publicPickerJob(row: Doc<"dashboardConfigurationJobs">): RolePickerJob {
    return { id: row._id, actorId: row.actorId, operation: row.operation as RolePickerMemberOperation, state: row.state === "queued" || row.state === "applied" ? row.state : "failed",
        createdAt: row.createdAt, expiresAt: row.expiresAt, ...(row.error ? { error: row.error } : {}) }
}
export async function memberJob(ctx: Read, serverId: string, jobId: unknown, actorId: unknown) {
    const id = typeof jobId === "string" ? ctx.db.normalizeId("dashboardConfigurationJobs", jobId) : null, job = id ? await ctx.db.get(id) : null
    if (!job || job.family !== ROLE_PICKER_MEMBER_FAMILY || job.serverId !== serverId || job.actorId !== actorId) fail(403, "Role picker grant mismatch")
    return job
}
// The member's dashboard session must still cover the server, as manager jobs require of their sessions
export async function memberGrant(ctx: Read, job: Doc<"dashboardConfigurationJobs">, now = Date.now()) {
    const session = await ctx.db.get(job.sessionId)
    return job.expiresAt > now && !!session && session.expiresAt > now && session.lifetimeAt > now && session.userId === job.actorId
        && (session.servers.some(server => server.id === job.serverId) || (session.memberServers ?? []).some(server => server.id === job.serverId))
}
// Role writes for a request run only while it is queued and its sign-in grant holds
export async function pickerJobFence(ctx: Read, serverId: string, jobId: unknown, actorId: string) {
    const job = await memberJob(ctx, serverId, jobId, actorId)
    if (job.state !== "queued" || !await memberGrant(ctx, job)) fail(403, "Role picker request expired")
    return job
}
// The current menu rule for one role and member. Access lists apply to claims and drops alike
export async function pickerMenu(ctx: Read, serverId: string, member: Pick<RolesMemberContext, "userId" | "roleIds" | "isBot">, menuName: string, roleId: string) {
    if (member.isBot) fail(403, "Bot participation unavailable")
    const settings = await readRolePicker(ctx, serverId), menu = settings.menus.find(row => row.name === menuName)
    if (!settings.enabled) fail(403, "Role picker is off")
    if (!menu?.roleIds.includes(roleId)) fail(403, "Role is not in this menu")
    if (!await memberAllowed(ctx, serverId, ROLE_PICKER_FEATURE, member)) fail(403, "Role picker access denied")
    return menu
}
// A lookup keeps the member's role IDs for ten minutes, with the names and colors of the server's menu roles only. Each completed change refreshes them
export async function writeSnapshot(ctx: MutationCtx, serverId: string, member: Pick<RolesMemberContext, "userId" | "roleIds">, now: number, settings: RolePickerSettings, display?: RolePickerRoleDisplay[]): Promise<void> {
    const row = await ctx.db.query("rolePickerSnapshots").withIndex("by_member", q => q.eq("serverId", serverId).eq("userId", member.userId)).unique()
    const menuRoles = new Set(settings.menus.flatMap(menu => menu.roleIds)), roles = (display ?? row?.roles ?? []).filter(role => menuRoles.has(role.roleId))
    const expiresAt = now + ROLE_PICKER_SNAPSHOT_MS, value = { roleIds: [...member.roleIds], roles, observedAt: now, expiresAt }
    const id = row?._id ?? await ctx.db.insert("rolePickerSnapshots", { serverId, userId: member.userId, ...value })
    if (row) await ctx.db.patch(row._id, value)
    await ctx.scheduler.runAt(expiresAt, internal.rolePicker.expireSnapshot, { id })
}
