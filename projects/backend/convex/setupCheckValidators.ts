import { v } from "convex/values"

const role = v.object({ id: v.string(), name: v.string() })
// A stored permission check problem, see SetupProblem in dashboard-contracts.d.ts
export const setupProblem = v.union(
    v.object({ kind: v.literal("permissions"), feature: v.string(), permissions: v.array(v.string()) }),
    v.object({ kind: v.literal("hierarchy"), feature: v.string(), roles: v.array(role) }),
    v.object({ kind: v.literal("gateway"), state: v.string() }),
    v.object({ kind: v.literal("dangerous-role"), role, permissions: v.array(v.string()), members: v.optional(v.number()) }),
    v.object({ kind: v.literal("staff-permissions"), staffClass: v.string(), role, permissions: v.array(v.string()) }),
    v.object({ kind: v.literal("verification-bypass"), features: v.array(v.string()) }),
)
