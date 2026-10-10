import { v } from "convex/values"

// A stored permission check problem, see SetupProblem in dashboard-contracts.d.ts
export const setupProblem = v.union(
    v.object({ kind: v.literal("permissions"), feature: v.string(), permissions: v.array(v.string()) }),
    v.object({ kind: v.literal("hierarchy"), feature: v.string(), roles: v.array(v.object({ id: v.string(), name: v.string() })) }),
    v.object({ kind: v.literal("gateway"), state: v.string() }),
)
