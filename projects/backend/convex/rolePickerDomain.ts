import type { RolePickerMemberOperation, RolePickerMode, RolePickerOperation, RolePickerRoleDisplay } from "../contracts.js"
import { MEMBER_ACCESS_LIMIT, memberAccessKeys } from "./memberAccess.ts"
import { shape } from "./publishingDomain.ts"
import { bool, fail, integer, object, requireId } from "./validation.ts"

// The feature name in the shared member access lists
export const ROLE_PICKER_FEATURE = "rolepicker"
// Website member requests share the dashboard configuration job table under this family
export const ROLE_PICKER_MEMBER_FAMILY = "member"
export const ROLE_PICKER_MENUS = 10
export const ROLE_PICKER_MENU_ROLES = 25
export const ROLE_PICKER_SNAPSHOT_MS = 600000
export const ROLE_PICKER_REQUEST_MS = 120000
// Request records follow the dashboard job retention of one day
export const ROLE_PICKER_RETENTION_MS = 86400000
export const ROLE_PICKER_RATE_WINDOW_MS = 60000
export const ROLE_PICKER_RATE = 10
export const ROLE_PICKER_PENDING = 3
export const ROLE_PICKER_QUEUE = 50
export const pickerKey = (menu: string) => `picker:${menu}`

export function menuName(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)) fail(400, "Menu names use up to 32 lowercase letters, digits, underscores or hyphens")
    return value
}
export function menuMode(value: unknown): RolePickerMode {
    if (value !== "single" && value !== "multi") fail(400, "Choose single or multi")
    return value
}
// One line of plain text, without control or text direction characters
export function menuDescription(value: unknown): string {
    const hidden = (code: number) => code < 32 || code === 127 || code >= 0x202a && code <= 0x202e || code >= 0x2066 && code <= 0x2069 || code === 0xfeff
    if (typeof value !== "string" || !value.length || value !== value.trim() || value.length > 200 || [...value].some(char => hidden(char.codePointAt(0)!))) fail(400, "Descriptions need 1 to 200 characters on one line")
    return value
}
function roleList(value: unknown, minimum: number): string[] {
    if (!Array.isArray(value) || value.length < minimum || value.length > ROLE_PICKER_MENU_ROLES) fail(400, `A menu holds at most ${ROLE_PICKER_MENU_ROLES} roles`)
    const roleIds = value.map(requireId)
    if (new Set(roleIds).size !== roleIds.length) fail(400, "Duplicate menu role")
    return roleIds
}
function idList(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length || value.length > MEMBER_ACCESS_LIMIT) fail(400, `Name 1 to ${MEMBER_ACCESS_LIMIT} roles or users`)
    return [...new Set(value.map(requireId))]
}
// Dashboard saves use module, menu-set, menu-remove and access-set. Chat commands use the incremental operations
export function rolePickerOperation(value: unknown, dashboard = false): RolePickerOperation {
    const input = object(value)
    if (input.type === "module") { shape(input, ["type", "enabled"], ["type", "enabled"]); return { type: "module", enabled: bool(input.enabled) } }
    if (input.type === "menu-set") {
        shape(input, ["type", "name", "description", "mode", "roleIds"], ["type", "name", "mode", "roleIds"])
        return { type: "menu-set", name: menuName(input.name), ...(input.description !== undefined ? { description: menuDescription(input.description) } : {}), mode: menuMode(input.mode), roleIds: roleList(input.roleIds, 0) }
    }
    if (input.type === "menu-remove") { shape(input, ["type", "name"], ["type", "name"]); return { type: "menu-remove", name: menuName(input.name) } }
    if (input.type === "access-set") {
        shape(input, ["type", ...memberAccessKeys], ["type", ...memberAccessKeys])
        for (const key of memberAccessKeys) if (!Array.isArray(input[key]) || input[key].length > MEMBER_ACCESS_LIMIT) fail(400, `Each access list holds at most ${MEMBER_ACCESS_LIMIT} entries`)
        const list = (key: typeof memberAccessKeys[number]) => [...new Set((input[key] as unknown[]).map(requireId))]
        return { type: "access-set", allowRoleIds: list("allowRoleIds"), blockRoleIds: list("blockRoleIds"), allowUserIds: list("allowUserIds"), blockUserIds: list("blockUserIds") }
    }
    if (dashboard) fail(400, "Unsupported role picker operation")
    if (input.type === "menu-add") {
        shape(input, ["type", "name", "mode", "description"], ["type", "name", "mode"])
        return { type: "menu-add", name: menuName(input.name), mode: menuMode(input.mode), ...(input.description !== undefined ? { description: menuDescription(input.description) } : {}) }
    }
    if (input.type === "menu-update") {
        shape(input, ["type", "name", "mode", "description"], ["type", "name"])
        if (input.mode === undefined && input.description === undefined) fail(400, "Choose a menu setting")
        return { type: "menu-update", name: menuName(input.name), ...(input.mode !== undefined ? { mode: menuMode(input.mode) } : {}),
            ...(input.description !== undefined ? { description: input.description === null ? null : menuDescription(input.description) } : {}) }
    }
    if (input.type === "menu-role-add" || input.type === "menu-role-remove") {
        shape(input, ["type", "name", "roleIds"], ["type", "name", "roleIds"])
        return { type: input.type, name: menuName(input.name), roleIds: roleList(input.roleIds, 1) }
    }
    if (input.type === "access-add" || input.type === "access-remove") {
        shape(input, ["type", "list", "kind", "ids"], ["type", "list", "kind", "ids"])
        if (input.list !== "allow" && input.list !== "block") fail(400, "Choose the allow or block list")
        if (input.kind !== "role" && input.kind !== "user") fail(400, "Choose role or user")
        return { type: input.type, list: input.list, kind: input.kind, ids: idList(input.ids) }
    }
    fail(400, "Unsupported role picker operation")
}
// Server role names and colors the bot read. Absent means the caller sent none, which keeps names already stored
export function roleDisplay(value: unknown): RolePickerRoleDisplay[] | undefined {
    if (value === undefined) return undefined
    if (!Array.isArray(value) || value.length > 1000) fail(400, "Invalid role names")
    const result = value.map(row => {
        const input = shape(row, ["roleId", "name", "color"], ["roleId", "name", "color"])
        if (typeof input.name !== "string" || input.name.length > 100) fail(400, "Invalid role names")
        return { roleId: requireId(input.roleId), name: input.name, color: integer(input.color, 0, 0xffffff) }
    })
    if (new Set(result.map(row => row.roleId)).size !== result.length) fail(400, "Invalid role names")
    return result
}
export function memberOperation(value: unknown): RolePickerMemberOperation {
    const input = object(value)
    if (input.type === "lookup") { shape(input, ["type"], ["type"]); return { type: "lookup" } }
    if (input.type !== "claim" && input.type !== "drop") fail(400, "Unsupported role picker request")
    shape(input, ["type", "menu", "roleId"], ["type", "menu", "roleId"])
    return { type: input.type, menu: menuName(input.menu), roleId: requireId(input.roleId) }
}
// Fixed backend refusals from the shared role rules, worded for the member who asked
export function memberRefusal(error: string): string {
    if (error === "Rules acknowledgment required") return "Accept the server rules before choosing roles"
    if (error === "Role is not eligible for self service") return "This role cannot be self-assigned. It may sit above the bot or carry staff permissions"
    if (error === "Role picker access denied") return "You cannot use the role picker in this server"
    if (error === "Role is not in this menu") return "This role is no longer in that menu"
    if (error === "Role picker is off") return "The role picker is turned off in this server"
    return "Role changes are paused for your account or this server right now"
}
