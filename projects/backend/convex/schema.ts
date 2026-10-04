import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { responseKind, responseReply, responseTrigger } from "./responseValidators.ts"

export default defineSchema({
    generalSettings: defineTable({ serverId: v.string(), prefix: v.string(), revision: v.number(), updatedAt: v.number(), updatedBy: v.string() }).index("by_server", ["serverId"]),
    afkStatuses: defineTable({
        serverId: v.string(),
        userId: v.string(),
        reason: v.string(),
        since: v.number(),
    }).index("by_server_user", ["serverId", "userId"]),
    responseSettings: defineTable({
        serverId: v.string(), customEnabled: v.boolean(), autoEnabled: v.boolean(),
        customRevision: v.optional(v.number()), autoRevision: v.optional(v.number()),
    }).index("by_server", ["serverId"]),
    responseDefinitions: defineTable({
        serverId: v.string(), kind: responseKind, name: v.string(), reply: responseReply,
        trigger: v.optional(responseTrigger), channelIds: v.array(v.string()), roleIds: v.array(v.string()),
        cooldownSeconds: v.number(), priority: v.number(), enabled: v.boolean(),
        createdAt: v.number(), updatedAt: v.number(),
    }).index("by_server", ["serverId"])
        .index("by_server_kind_name", ["serverId", "kind", "name"]),
    responseReceipts: defineTable({ serverId: v.string(), messageId: v.string(), expiresAt: v.number() })
        .index("by_server_message", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    responseCooldowns: defineTable({
        serverId: v.string(), definitionId: v.id("responseDefinitions"), userId: v.string(), nextEligibleAt: v.number(),
    }).index("by_definition_user", ["definitionId", "userId"]).index("by_expiry", ["nextEligibleAt"]),
})
