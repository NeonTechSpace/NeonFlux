import { v } from "convex/values"

// Stored shapes of the structure editor, see StructureRead and StructureResult in dashboard-contracts.d.ts. Types are checked by structureDomain.ts
export const structureEntry = v.object({ id: v.string(), type: v.string(), name: v.string(), parentId: v.union(v.string(), v.null()) })
export const structureThread = v.object({ id: v.string(), parentId: v.string(), name: v.string(), private: v.boolean(), archived: v.boolean() })
export const structureRead = v.object({ readAt: v.number(), channels: v.array(v.object({ id: v.string(), type: v.string(), name: v.string(), parentId: v.union(v.string(), v.null()), manage: v.boolean() })),
    threads: v.array(structureThread), threadsTruncated: v.boolean() })
const place = v.object({ parentId: v.union(v.string(), v.null()), parentName: v.union(v.string(), v.null()), afterId: v.union(v.string(), v.null()), afterName: v.union(v.string(), v.null()) })
const change = v.union(v.object({ type: v.literal("rename"), channelId: v.string(), from: v.string(), to: v.string() }),
    v.object({ type: v.literal("move"), channelId: v.string(), name: v.string(), from: place, to: place }))
export const structureResult = v.object({ itemNo: v.number(), change, outcome: v.union(v.literal("applied"), v.literal("skipped"), v.literal("conflict"), v.literal("blocked"), v.literal("refused"),
    v.literal("failed"), v.literal("uncertain")), reason: v.union(v.string(), v.null()) })
export const structureWork = v.union(v.object({ type: v.literal("read") }), v.object({ type: v.literal("threads"), channelId: v.string() }),
    v.object({ type: v.literal("save"), base: v.array(structureEntry), draft: v.array(structureEntry) }))
export const structureFailure = v.union(v.literal("unanswered"), v.literal("access"), v.literal("error"), v.literal("uncertain"))
