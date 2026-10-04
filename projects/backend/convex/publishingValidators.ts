import { v } from "convex/values"
export const publishingKind = v.union(v.literal("draft"), v.literal("template"))
const field = v.object({ name: v.string(), value: v.string(), inline: v.optional(v.boolean()) })
const media = v.object({ url: v.string(), description: v.optional(v.string()) })
export const publishingContent = v.object({ content: v.string(), embed: v.optional(v.object({
    title: v.optional(v.string()), description: v.optional(v.string()), url: v.optional(v.string()), color: v.optional(v.number()), timestamp: v.optional(v.string()),
    author: v.optional(v.object({ name: v.string(), url: v.optional(v.string()), iconUrl: v.optional(v.string()) })),
    footer: v.optional(v.object({ text: v.string(), iconUrl: v.optional(v.string()) })),
    image: v.optional(media), thumbnail: v.optional(media), fields: v.optional(v.array(field)),
})) })
export const publishingOutcome = v.union(v.literal("pending"), v.literal("sent"), v.literal("failed"), v.literal("uncertain"))
export const publishingObservation = v.object({ observedAt: v.number(), messageId: v.string(), channelId: v.string(), botId: v.string(), content: publishingContent })
