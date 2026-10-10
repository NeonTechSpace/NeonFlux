import { RolePickerManageRequest, RolePickerMemberOperation, RolePickerOperation, type RolePickerRoleDisplay } from "@neonflux/contracts/role-picker"
import { memberAccessOperation } from "./memberAccess.ts"
import { decode, fail, object } from "./validation.ts"

export { ROLE_PICKER_MENU_ROLES, ROLE_PICKER_MENUS } from "@neonflux/contracts/role-picker"
// The feature name in the shared member access lists
export const ROLE_PICKER_FEATURE = "rolepicker"
// Website member requests share the dashboard configuration job table under this family
export const ROLE_PICKER_MEMBER_FAMILY = "member"
export const ROLE_PICKER_SNAPSHOT_MS = 600000
export const ROLE_PICKER_REQUEST_MS = 120000
// Request records follow the dashboard job retention of one day
export const ROLE_PICKER_RETENTION_MS = 86400000
export const ROLE_PICKER_RATE_WINDOW_MS = 60000
export const ROLE_PICKER_RATE = 10
export const ROLE_PICKER_PENDING = 3
export const ROLE_PICKER_QUEUE = 50
export const pickerKey = (menu: string) => `picker:${menu}`

// Dashboard saves use module, menu-set, menu-remove and access-set. Chat commands use the incremental operations
export function rolePickerOperation(value: unknown, dashboard = false): RolePickerOperation {
    const op = decode(RolePickerOperation, value)
    if (dashboard && op.type !== "module" && op.type !== "menu-set" && op.type !== "menu-remove" && op.type !== "access-set") fail(400, "Unsupported role picker operation")
    return op.type === "access-set" || op.type === "access-add" || op.type === "access-remove" ? memberAccessOperation(op, false) : op
}
// Server role names and colors the bot read. Absent means the caller sent none, which keeps names already stored
export const roleDisplay = (value: unknown): RolePickerRoleDisplay[] | undefined => value === undefined ? undefined : decode(RolePickerManageRequest.fields.display.schema, value, "Invalid role names")
// The member page shows these messages, so a request that is wrong in one way keeps the message it had
export function memberOperation(value: unknown): RolePickerMemberOperation {
    const input = object(value), { menu, roleId } = RolePickerMemberOperation.members[0].fields
    if (input.type !== "lookup" && input.type !== "claim" && input.type !== "drop") fail(400, "Unsupported role picker request")
    if (input.type !== "lookup" && Object.hasOwn(input, "menu")) decode(menu, input.menu, "Menu names use up to 32 lowercase letters, digits, underscores or hyphens")
    if (input.type !== "lookup" && Object.hasOwn(input, "roleId")) decode(roleId, input.roleId)
    return decode(RolePickerMemberOperation, input, "Invalid publishing input")
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
