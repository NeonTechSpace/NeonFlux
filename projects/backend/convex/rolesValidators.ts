import { v } from "convex/values"
import { publishingContent } from "./publishingValidators.ts"
export const rolesKind = v.union(v.literal("reaction"), v.literal("verification"))
export const rolesMapping = v.object({ emoji: v.string(), roleId: v.string(), prerequisiteRoleIds: v.array(v.string()), exclusionRoleIds: v.array(v.string()) })
export const rolesSettings = v.object({ panelsEnabled: v.boolean(), verificationEnabled: v.boolean(), autoroleEnabled: v.boolean(), humansOnly: v.boolean(), autoroleIds: v.array(v.string()), reservations: v.optional(v.array(v.object({ userId: v.string(), roleIds: v.array(v.string()) }))), revision: v.number() })
export const rolesPanelSnapshot = v.object({ revision: v.number(), publishedAt: v.number(), postNo: v.number(), postGeneration: v.number(), channelId: v.string(), messageId: v.string(), botId: v.string(), content: publishingContent, mappings: v.array(rolesMapping), exclusive: v.boolean() })
export const rolesOutcome = v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed"), v.literal("uncertain"))
export const rolesOwnershipStatus = v.union(v.literal("idle"), v.literal("pending"), v.literal("uncertain"))
export const rolesAction = v.union(v.literal("add"), v.literal("remove"))
export const rolesWithdrawalStatus = v.union(v.literal("pending"), v.literal("blocked"), v.literal("complete"))
export const rolesParticipationOperation = v.union(
    v.object({ type: v.literal("choose"), name: v.string(), revision: v.number(), roleId: v.string(), selected: v.boolean() }),
    v.object({ type: v.literal("reaction"), name: v.string(), revision: v.number(), messageId: v.string(), presentEmojis: v.array(v.string()), panelVerified: v.boolean() }),
    v.object({ type: v.literal("verify"), name: v.string(), revision: v.number(), messageId: v.optional(v.string()), panelVerified: v.optional(v.boolean()), reactionPresent: v.optional(v.boolean()) }),
    v.object({ type: v.literal("join") }),
    v.object({ type: v.literal("withdraw"), withdrawalId: v.string(), roleId: v.string() }),
    v.object({ type: v.literal("withdraw-member"), consumerKey: v.string(), roleId: v.string() }),
)
