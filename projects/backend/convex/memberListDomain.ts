import type { MemberListOperation } from "../contracts.js"
import { shape } from "./publishingDomain.ts"
import { fail, requireId } from "./validation.ts"

// Fluxer lists at most 250 roles per server
export function memberListOperation(value: unknown, serverId?: string): MemberListOperation {
    const raw = shape(value, ["type", "roleIds"], ["type"])
    if (raw.type === "reset") { shape(raw, ["type"]); return { type: "reset" } }
    if (raw.type !== "set") fail(400, "Unknown member list operation")
    shape(raw, ["type", "roleIds"], ["type", "roleIds"])
    if (!Array.isArray(raw.roleIds) || !raw.roleIds.length || raw.roleIds.length > 250) fail(400, "List 1 to 250 roles")
    const roleIds = raw.roleIds.map(requireId)
    if (new Set(roleIds).size !== roleIds.length || serverId !== undefined && roleIds.includes(serverId)) fail(400, "List each role once, without the everyone role")
    return { type: "set", roleIds }
}
