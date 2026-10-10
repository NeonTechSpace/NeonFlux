import { v } from "convex/values"
import { publishingContent } from "./publishingValidators.ts"
export const ticketVisibility = v.union(v.literal("private"), v.literal("public"))
export const ticketOverwrite = v.object({
    id: v.string(),
    type: v.union(v.literal("role"), v.literal("member")),
    allow: v.string(),
    deny: v.string(),
})
export const ticketChannel = v.object({
    channelId: v.string(),
    serverId: v.string(),
    type: v.literal("text"),
    name: v.string(),
    parentId: v.union(v.string(), v.null()),
    overwrites: v.array(ticketOverwrite),
})
export const ticketSettings = v.object({
    enabled: v.boolean(),
    retentionDays: v.number(),
})
export const ticketCanned = v.object({
    name: v.string(),
    templateName: v.string(),
    templateRevision: v.number(),
    content: publishingContent,
})
export const ticketCategory = v.object({
    name: v.string(),
    revision: v.number(),
    enabled: v.boolean(),
    visibility: ticketVisibility,
    description: v.string(),
    parentId: v.union(v.string(), v.null()),
    supportRoleIds: v.array(v.string()),
    questions: v.array(v.string()),
    cannedReplies: v.array(ticketCanned),
})
export const ticketIntakeCategory = v.object({
    parentId: v.union(v.string(), v.null()),
    name: v.string(),
    revision: v.number(),
    enabled: v.boolean(),
    visibility: ticketVisibility,
    description: v.string(),
    supportRoleIds: v.array(v.string()),
    questions: v.array(v.string()),
})
export const ticketState = v.union(
    ...["creating", "open", "closing", "closed", "reopening", "deleting", "retired", "failed", "uncertain"].map((x) =>
        v.literal(x as "creating" | "open" | "closing" | "closed" | "reopening" | "deleting" | "retired" | "failed" | "uncertain"),
    ),
)
export const ticketAction = v.union(
    ...["create", "introduction", "reply", "close-everyone", "close-requester", "reopen-requester", "reopen-everyone", "delete"].map((x) =>
        v.literal(
            x as
                | "create"
                | "introduction"
                | "reply"
                | "close-everyone"
                | "close-requester"
                | "reopen-requester"
                | "reopen-everyone"
                | "delete",
        ),
    ),
)
export const ticketGrant = v.object({
    attemptId: v.string(),
    attemptNo: v.number(),
    ticketNo: v.number(),
    generation: v.number(),
    sourceId: v.string(),
    actorId: v.string(),
    botId: v.string(),
    requesterId: v.string(),
    requesterJoinedAt: v.string(),
    visibility: ticketVisibility,
    supportRoleIds: v.array(v.string()),
    action: ticketAction,
    dispatchExpiresAt: v.number(),
    nativeDeadlineMs: v.literal(5000),
    channelId: v.optional(v.string()),
    expectedChannel: v.optional(ticketChannel),
    desiredChannel: v.optional(ticketChannel),
    targetOverwrite: v.optional(ticketOverwrite),
    ownedPermissions: v.optional(v.string()),
    channelName: v.optional(v.string()),
    parentId: v.optional(v.union(v.string(), v.null())),
    overwrites: v.optional(v.array(ticketOverwrite)),
    content: v.optional(publishingContent),
})
