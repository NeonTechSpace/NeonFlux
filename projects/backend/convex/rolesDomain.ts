import type { RolesEvaluateOperation, RolesMapping, RolesMemberContext, RolesReservation, RolesRoleSnapshot, RolesSettings } from "../contracts.js"
import { shape } from "./publishingDomain.ts"
import { fail, requireId, requireServer, bool, fresh, ids, integer, token } from "./validation.ts"

export const ROLES_DAY = 86400000
export const ROLES_BATCH = 32
export const ROLES_DISPATCH_WINDOW = 180000
export const ROLES_NATIVE_DEADLINE = 5000
export const ROLES_MARGIN = 5000
// Settled role history is kept for a fixed half year
export const ROLES_RETENTION = 180 * ROLES_DAY
// Only ordinary, known member capabilities are eligible for self-service assignment
export const SAFE_ROLE_PERMISSIONS = [6, 8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 21, 25, 26, 37].reduce((bits, bit) => bits | (1n << BigInt(bit)), 0n)
export const defaultRolesSettings = (): RolesSettings => ({ panelsEnabled: false, verificationEnabled: false, autoroleEnabled: false, humansOnly: true, autoroleIds: [], revision: 1 })
export function reservations(value: unknown): RolesReservation[] {
    if (!Array.isArray(value) || value.length > 100) fail(400, "Invalid role reservations")
    const result = value.map(value => {
        const input = shape(value, ["userId", "roleIds"], ["userId", "roleIds"])
        const roleIds = ids(input.roleIds, 20)
        if (!roleIds.length) fail(400, "A reservation needs at least one role")
        return { userId: requireId(input.userId), roleIds }
    })
    if (new Set(result.map(row => row.userId)).size !== result.length) fail(400, "Duplicate role reservation")
    return result
}
export function autoroleIds(settings: Pick<RolesSettings, "autoroleIds" | "reservations">, userId?: string): string[] {
    return [...new Set([...settings.autoroleIds, ...(settings.reservations ?? []).filter(row => userId === undefined || row.userId === userId).flatMap(row => row.roleIds)])]
}
export function epoch(value: unknown): string {
    if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail(400, "Invalid membership epoch")
    return value
}
export function emoji(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 100 || /[\r\n\u000c\u202e]/.test(value)) fail(400, "Invalid role emoji")
    return value
}
export function mappings(value: unknown): RolesMapping[] {
    if (!Array.isArray(value) || value.length > 20) fail(400, "Invalid role mappings")
    const result = value.map(value => {
        const input = shape(value, ["emoji", "roleId", "prerequisiteRoleIds", "exclusionRoleIds"], ["emoji", "roleId", "prerequisiteRoleIds", "exclusionRoleIds"])
        const mapping = { emoji: emoji(input.emoji), roleId: requireId(input.roleId), prerequisiteRoleIds: ids(input.prerequisiteRoleIds), exclusionRoleIds: ids(input.exclusionRoleIds) }
        if (mapping.prerequisiteRoleIds.includes(mapping.roleId) || mapping.exclusionRoleIds.includes(mapping.roleId) || mapping.prerequisiteRoleIds.some(id => mapping.exclusionRoleIds.includes(id))) fail(400, "Conflicting role requirements")
        return mapping
    })
    if (new Set(result.map(x => x.emoji)).size !== result.length || new Set(result.map(x => x.roleId)).size !== result.length) fail(400, "Duplicate role mapping")
    return result
}
export function roleSnapshots(value: unknown): RolesRoleSnapshot[] {
    if (!Array.isArray(value) || value.length > 1000) fail(400, "Invalid role snapshot")
    const result = value.map(value => {
        const input = shape(value, ["roleId", "permissions", "botCanManage", "actorCanManage"], ["roleId", "permissions", "botCanManage", "actorCanManage"])
        if (typeof input.permissions !== "string" || !/^(0|[1-9]\d{0,19})$/.test(input.permissions) || BigInt(input.permissions) > 18446744073709551615n) fail(400, "Invalid role permissions")
        return { roleId: requireId(input.roleId), permissions: input.permissions, botCanManage: bool(input.botCanManage), actorCanManage: bool(input.actorCanManage) }
    })
    if (new Set(result.map(x => x.roleId)).size !== result.length) fail(400, "Duplicate role snapshot")
    return result
}
export function safeRole(serverId: string, roleId: string, roles: RolesRoleSnapshot[], staffRoleIds: string[], configuration: boolean) {
    const role = roles.find(x => x.roleId === roleId)
    if (roleId === serverId || staffRoleIds.includes(roleId) || !role || !role.botCanManage || configuration && !role.actorCanManage || (BigInt(role.permissions) & ~SAFE_ROLE_PERMISSIONS) !== 0n) fail(403, "Role is not eligible for self service")
}
export function memberContext(value: unknown): RolesMemberContext {
    const input = shape(value, ["userId", "joinedAt", "roleIds", "isBot", "timeoutUntil", "botId", "botAuthorized", "roles"], ["userId", "joinedAt", "roleIds", "isBot", "timeoutUntil", "botId", "botAuthorized", "roles"])
    return { userId: requireId(input.userId), joinedAt: epoch(input.joinedAt), roleIds: ids(input.roleIds, 1000), isBot: bool(input.isBot), timeoutUntil: input.timeoutUntil === null ? null : epoch(input.timeoutUntil), botId: requireId(input.botId), botAuthorized: bool(input.botAuthorized), roles: roleSnapshots(input.roles) }
}
export function rolesSource(input: Record<string, unknown>, now: number) {
    const serverId = requireId(input.serverId); requireServer(serverId)
    const sourceId = token(input.sourceId), createdAt = integer(input.createdAt, 0, Number.MAX_SAFE_INTEGER)
    fresh(createdAt, now)
    return { serverId, sourceId, createdAt }
}
export function claimToken(value: unknown): string {
    if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) fail(400, "Invalid role claim")
    return value
}
export function consumerKey(name: string, revision: number) { return `panel:${name}:${revision}` }
export function evaluationKey(value: Record<string, unknown>): string {
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value
    return JSON.stringify(canonical(value))
}
export function participationOperation(value: unknown): RolesEvaluateOperation {
    const input = shape(value, ["type", "name", "revision", "roleId", "selected", "messageId", "presentEmojis", "panelVerified", "reactionPresent", "withdrawalId", "consumerKey"])
    if (input.type === "level-sync") {
        shape(input, ["type", "roleId"], ["type", "roleId"])
        return { type: "level-sync", roleId: requireId(input.roleId) }
    }
    if (input.type === "join") { shape(input, ["type"], ["type"]); return { type: "join" } }
    if (input.type === "choose") {
        shape(input, ["type", "name", "revision", "roleId", "selected"], ["type", "name", "revision", "roleId", "selected"])
        return { type: "choose", name: panelName(input.name), revision: integer(input.revision, 1, Number.MAX_SAFE_INTEGER), roleId: requireId(input.roleId), selected: bool(input.selected) }
    }
    if (input.type === "reaction") {
        shape(input, ["type", "name", "revision", "messageId", "presentEmojis", "panelVerified"], ["type", "name", "revision", "messageId", "presentEmojis", "panelVerified"])
        if (!Array.isArray(input.presentEmojis) || input.presentEmojis.length > 20) fail(400, "Invalid current panel reactions")
        return { type: "reaction", name: panelName(input.name), revision: integer(input.revision, 1, Number.MAX_SAFE_INTEGER), messageId: requireId(input.messageId), presentEmojis: input.presentEmojis.map(emoji), panelVerified: bool(input.panelVerified) }
    }
    if (input.type === "verify") {
        shape(input, ["type", "name", "revision", "messageId", "panelVerified", "reactionPresent"], ["type", "name", "revision"])
        return { type: "verify", name: panelName(input.name), revision: integer(input.revision, 1, Number.MAX_SAFE_INTEGER), ...(input.messageId !== undefined ? { messageId: requireId(input.messageId) } : {}), ...(input.panelVerified !== undefined ? { panelVerified: bool(input.panelVerified) } : {}), ...(input.reactionPresent !== undefined ? { reactionPresent: bool(input.reactionPresent) } : {}) }
    }
    if (input.type === "withdraw") { shape(input, ["type", "withdrawalId", "roleId"], ["type", "withdrawalId", "roleId"]); return { type: "withdraw", withdrawalId: token(input.withdrawalId), roleId: requireId(input.roleId) } }
    if (input.type === "withdraw-member") {
        shape(input, ["type", "consumerKey", "roleId"], ["type", "consumerKey", "roleId"])
        if (typeof input.consumerKey !== "string" || !/^(panel:[a-z0-9][a-z0-9_-]{0,31}|autorole):[1-9]\d{0,15}$/.test(input.consumerKey)) fail(400, "Invalid consumer reference")
        return { type: "withdraw-member", consumerKey: input.consumerKey, roleId: requireId(input.roleId) }
    }
    fail(400, "Invalid role participation")
}
function panelName(value: unknown) {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)) fail(400, "Invalid panel name")
    return value
}
export function eligible(mapping: RolesMapping, roleIds: string[]) {
    return mapping.prerequisiteRoleIds.every(id => roleIds.includes(id)) && !mapping.exclusionRoleIds.some(id => roleIds.includes(id))
}
