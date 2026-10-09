import { v } from "convex/values"

export const rolePickerRoleDisplay = v.object({ roleId: v.string(), name: v.string(), color: v.number() })
export const rolePickerMenu = v.object({ name: v.string(), description: v.optional(v.string()), mode: v.union(v.literal("single"), v.literal("multi")), roleIds: v.array(v.string()), display: v.optional(v.array(rolePickerRoleDisplay)) })
export const memberAccessFields = { allowRoleIds: v.array(v.string()), blockRoleIds: v.array(v.string()), allowUserIds: v.array(v.string()), blockUserIds: v.array(v.string()) }
