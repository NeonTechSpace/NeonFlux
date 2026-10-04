import { v } from "convex/values"
import { publishingContent } from "./publishingValidators.ts"
export const greetingsRoute = v.union(v.literal("welcome"), v.literal("dm"), v.literal("goodbye"))
export const greetingsRouteSettings = v.object({ revision: v.number(), enabled: v.boolean(), timing: v.union(v.literal("join"), v.literal("verified")), channelId: v.optional(v.string()), templateName: v.optional(v.string()), templateRevision: v.optional(v.number()), content: v.optional(publishingContent) })
export const greetingsSettings = v.object({ routes: v.object({ welcome: greetingsRouteSettings, dm: greetingsRouteSettings, goodbye: greetingsRouteSettings }), claimsPerMinute: v.number(), retentionDays: v.number() })
export const greetingsState = v.union(v.literal("waiting"), v.literal("ready"), v.literal("reserved"), v.literal("sent"), v.literal("failed"), v.literal("uncertain"), v.literal("cancelled"), v.literal("expired"))
export const greetingsReason = v.union(v.literal("verification"), v.literal("eligibility"), v.literal("configuration"), v.literal("membership"), v.literal("lifetime"), v.literal("capacity"))
export const greetingsGrant = v.object({ deliveryId: v.string(), deliveryNo: v.number(), route: greetingsRoute, routeRevision: v.number(), templateName: v.string(), templateRevision: v.number(), userId: v.string(), joinedAt: v.string(), memberGeneration: v.number(), botId: v.string(), channelId: v.optional(v.string()), content: publishingContent, canonicalContent: publishingContent, dispatchExpiresAt: v.number(), nativeDeadlineMs: v.literal(5000) })
