import { v } from "convex/values"
import { PublishingKind, PublishingOutcome } from "@neonflux/contracts/publishing-base"

// Stored enums follow the shared literals
export const publishingKind = v.union(...PublishingKind.literals.map(kind => v.literal(kind)))
const field = v.object({ name: v.string(), value: v.string(), inline: v.optional(v.boolean()) })
const media = v.object({ url: v.string(), description: v.optional(v.string()) })
export const publishingContent = v.object({ content: v.string(), embed: v.optional(v.object({
    title: v.optional(v.string()), description: v.optional(v.string()), url: v.optional(v.string()), color: v.optional(v.number()), timestamp: v.optional(v.string()),
    author: v.optional(v.object({ name: v.string(), url: v.optional(v.string()), iconUrl: v.optional(v.string()) })),
    footer: v.optional(v.object({ text: v.string(), iconUrl: v.optional(v.string()) })),
    image: v.optional(media), thumbnail: v.optional(media), fields: v.optional(v.array(field)),
})) })
export const publishingOutcome = v.union(...PublishingOutcome.literals.map(outcome => v.literal(outcome)))
export const publishingObservation = v.object({ observedAt: v.number(), messageId: v.string(), channelId: v.string(), botId: v.string(), content: publishingContent })
