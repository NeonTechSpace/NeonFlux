import { v } from "convex/values"

export const temporaryRoleProblem = v.union(
    v.literal("permission"),
    v.literal("role"),
    v.literal("refused"),
    v.literal("uncertain"),
    v.literal("unavailable"),
    v.literal("waiting"),
)
export const temporaryRoleDefault = v.object({
    roleId: v.string(),
    defaultSeconds: v.optional(v.number()),
    maxSeconds: v.optional(v.number()),
})
