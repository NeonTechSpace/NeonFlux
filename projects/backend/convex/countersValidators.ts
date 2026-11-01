import { v } from "convex/values"

export const counterKind = v.union(v.literal("members"), v.literal("role"))
export const counterProblem = v.union(v.literal("channel"), v.literal("permission"))
export const counterCountProblem = v.union(v.literal("permission"), v.literal("twoFactor"))
