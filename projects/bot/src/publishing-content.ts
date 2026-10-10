import type { Message } from "@neontechspace/fluxerly/effect"
import { Schema } from "effect"
import { PublishingContent, canonicalPublishingContent, type PublishingEmbed } from "@neonflux/contracts/publishing-base"

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
export function publishingMessageContent(message: Message): PublishingContent | undefined {
    const embeds = message.embeds.filter((embed) => embed.type === "rich")
    if (embeds.length > 1) return undefined
    const rich = embeds[0]
    const content: Mutable<PublishingContent> = { content: message.content }
    if (rich) {
        const embed: Mutable<PublishingEmbed> = {}
        for (const field of ["title", "description", "url", "timestamp"] as const) if (rich[field] !== undefined) embed[field] = rich[field]!
        if (rich.color !== undefined) embed.color = rich.color
        if (rich.author) embed.author = { name: rich.author.name, ...(rich.author.url !== undefined ? { url: rich.author.url } : {}), ...(rich.author.iconUrl !== undefined ? { iconUrl: rich.author.iconUrl } : {}) }
        if (rich.footer) embed.footer = { text: rich.footer.text, ...(rich.footer.iconUrl !== undefined ? { iconUrl: rich.footer.iconUrl } : {}) }
        for (const field of ["image", "thumbnail"] as const) if (rich[field]) embed[field] = { url: rich[field]!.url, ...(rich[field]!.description !== undefined ? { description: rich[field]!.description } : {}) }
        if (rich.fields) embed.fields = rich.fields.map((field) => ({ name: field.name, value: field.value, inline: field.inline }))
        content.embed = embed
    }
    try { return canonicalPublishingContent(Schema.decodeUnknownSync(PublishingContent, { onExcessProperty: "error" })(content)) } catch { return undefined }
}
