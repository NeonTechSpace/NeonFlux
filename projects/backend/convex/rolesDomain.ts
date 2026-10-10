import { Schema } from "effect"
import { Id, IsoTime, List } from "@neonflux/contracts/common"
import { RolesClaimToken, RolesEmoji, RolesMappingsInput, RolesReservationsInput, RolesSource, type RolesMapping, type RolesReservation, type RolesSettings } from "@neonflux/contracts/roles"
import { RolesMemberContext, RolesRoleSnapshot } from "@neonflux/contracts/shared"
import { decode, fail, requireServer, fresh } from "./validation.ts"

export { ROLES_DISPATCH_WINDOW, ROLES_NATIVE_DEADLINE } from "@neonflux/contracts/roles"
export const ROLES_DAY = 86400000
export const ROLES_BATCH = 32
export const ROLES_MARGIN = 5000
// Settled role history is kept for a fixed half year
export const ROLES_RETENTION = 180 * ROLES_DAY
// Only ordinary, known member capabilities are eligible for self-service assignment
export const SAFE_ROLE_PERMISSIONS = [6, 8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 21, 25, 26, 37].reduce((bits, bit) => bits | (1n << BigInt(bit)), 0n)
export const defaultRolesSettings = (): RolesSettings => ({ panelsEnabled: false, verificationEnabled: false, autoroleEnabled: false, humansOnly: true, autoroleIds: [], revision: 1 })
export function reservations(value: unknown): RolesReservation[] {
    return decode(RolesReservationsInput, value, "Invalid role reservations").map(row => ({ userId: row.userId, roleIds: [...new Set(row.roleIds)] }))
}
export function autoroleIds(settings: Pick<RolesSettings, "autoroleIds" | "reservations">, userId?: string): string[] {
    return [...new Set([...settings.autoroleIds, ...(settings.reservations ?? []).filter(row => userId === undefined || row.userId === userId).flatMap(row => row.roleIds)])]
}
export const epoch = (value: unknown): string => decode(IsoTime, value, "Invalid membership epoch")
export const emoji = (value: unknown): string => decode(RolesEmoji, value, "Invalid role emoji")
export function mappings(value: unknown): RolesMapping[] {
    return decode(RolesMappingsInput, value, "Invalid role mappings").map(row => ({ emoji: row.emoji, roleId: row.roleId, prerequisiteRoleIds: [...new Set(row.prerequisiteRoleIds)], exclusionRoleIds: [...new Set(row.exclusionRoleIds)] }))
}
// Snapshots name each role once. The member's read server is checked at the boundary, so it is not kept
function snapshots(roles: readonly RolesRoleSnapshot[]): RolesRoleSnapshot[] {
    if (new Set(roles.map(x => x.roleId)).size !== roles.length) fail(400, "Duplicate role snapshot")
    return roles.map(role => ({ roleId: role.roleId, permissions: role.permissions, botCanManage: role.botCanManage, actorCanManage: role.actorCanManage }))
}
export const roleSnapshots = (value: unknown): RolesRoleSnapshot[] => snapshots(decode(List(RolesRoleSnapshot, 1000), value, "Invalid role snapshot"))
export function safeRole(serverId: string, roleId: string, roles: RolesRoleSnapshot[], staffRoleIds: string[], configuration: boolean) {
    const role = roles.find(x => x.roleId === roleId)
    if (roleId === serverId || staffRoleIds.includes(roleId) || !role || !role.botCanManage || configuration && !role.actorCanManage || (BigInt(role.permissions) & ~SAFE_ROLE_PERMISSIONS) !== 0n) fail(403, "Role is not eligible for self service", "ROLE_NOT_ELIGIBLE")
}
export function memberContext(value: unknown): RolesMemberContext {
    const input = decode(RolesMemberContext, value)
    return { userId: input.userId, joinedAt: input.joinedAt, roleIds: [...new Set(input.roleIds)], isBot: input.isBot, timeoutUntil: input.timeoutUntil, botId: input.botId, botAuthorized: input.botAuthorized, roles: snapshots(input.roles) }
}
const RolesSourceRequest = Schema.Struct({ serverId: Id, ...RolesSource.fields })
export function rolesSource(input: Record<string, unknown>, now: number) {
    const source = decode(RolesSourceRequest, { serverId: input.serverId, sourceId: input.sourceId, createdAt: input.createdAt })
    requireServer(source.serverId)
    fresh(source.createdAt, now)
    return source
}
export const claimToken = (value: unknown): string => decode(RolesClaimToken, value, "Invalid role claim")
export function consumerKey(name: string, revision: number) { return `panel:${name}:${revision}` }
export function evaluationKey(value: Record<string, unknown>): string {
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value
    return JSON.stringify(canonical(value))
}
export function eligible(mapping: RolesMapping, roleIds: string[]) {
    return mapping.prerequisiteRoleIds.every(id => roleIds.includes(id)) && !mapping.exclusionRoleIds.some(id => roleIds.includes(id))
}
