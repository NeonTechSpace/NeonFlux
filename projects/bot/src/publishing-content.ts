import type * as C from "@neonflux/backend/contracts"
import type { Message } from "@neontechspace/fluxerly/effect"
import { Schema } from "effect"

export const publishingText = (value: string) => value.replace(/[\u000c\u202e]/g, "").trim()
const text = (max: number, empty = false) => Schema.String.check(Schema.makeFilter((value) => value.length <= max && (empty || !!publishingText(value))))
const url = Schema.String.check(Schema.makeFilter((value) => {
    try { const parsed = new URL(value); return value.length <= 2048 && parsed.href.length <= 2048 && ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password } catch { return false }
}))
const timestamp = Schema.String.check(Schema.makeFilter((value) => {
    const match = /^(\d{4})-(\d\d)-(\d\d)T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.exec(value)
    if (!match || value.length > 128 || !Number.isFinite(Date.parse(value))) return false
    const month = Number(match[2]), day = Number(match[3])
    const year = Number(match[1]), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
}))
const optional = Schema.optionalKey
export const publishingEmbedSchema = Schema.Struct({
    title: optional(text(256, true)), description: optional(text(4096, true).check(Schema.makeFilter((value) => value === "" || !!publishingText(value)))), url: optional(url),
    color: optional(Schema.Number.check(Schema.makeFilter((value) => Number.isInteger(value) && value >= 0 && value <= 0xffffff))), timestamp: optional(timestamp),
    author: optional(Schema.Struct({ name: text(256), url: optional(url), iconUrl: optional(url) })),
    footer: optional(Schema.Struct({ text: text(2048), iconUrl: optional(url) })),
    image: optional(Schema.Struct({ url, description: optional(text(4096)) })),
    thumbnail: optional(Schema.Struct({ url, description: optional(text(4096)) })),
    fields: optional(Schema.mutable(Schema.Array(Schema.Struct({ name: text(256), value: text(1024, true), inline: optional(Schema.Boolean) }))).check(Schema.isMaxLength(25))),
}).check(Schema.makeFilter((value) => [value.title ?? "", value.description ?? "", value.author?.name ?? "", value.footer?.text ?? "", value.image?.description ?? "", value.thumbnail?.description ?? "", ...(value.fields ?? []).flatMap((field) => [field.name, field.value])].reduce((sum, value) => sum + value.length, 0) <= 6000))
export const publishingContentSchema = Schema.Struct({ content: text(2000, true), embed: optional(publishingEmbedSchema) })

export function canonicalPublishingContent(value: C.PublishingContent): C.PublishingContent {
    const result: C.PublishingContent = { content: publishingText(value.content) }
    const input = value.embed
    if (!input) return result
    const embed: C.PublishingEmbed = {}
    for (const field of ["title", "description"] as const) if (input[field] !== undefined && publishingText(input[field]!)) embed[field] = publishingText(input[field]!)
    if (input.url !== undefined) embed.url = new URL(input.url).href
    if (input.color !== undefined) embed.color = input.color
    if (input.timestamp !== undefined) embed.timestamp = new Date(input.timestamp).toISOString()
    if (input.author) embed.author = { name: publishingText(input.author.name), ...(input.author.url !== undefined ? { url: new URL(input.author.url).href } : {}), ...(input.author.iconUrl !== undefined ? { iconUrl: new URL(input.author.iconUrl).href } : {}) }
    if (input.footer) embed.footer = { text: publishingText(input.footer.text), ...(input.footer.iconUrl !== undefined ? { iconUrl: new URL(input.footer.iconUrl).href } : {}) }
    for (const field of ["image", "thumbnail"] as const) if (input[field]) embed[field] = { url: new URL(input[field]!.url).href, ...(input[field]!.description !== undefined ? { description: publishingText(input[field]!.description!) } : {}) }
    if (input.fields?.length) embed.fields = input.fields.map((field) => ({ name: publishingText(field.name), value: publishingText(field.value), ...(field.inline ? { inline: true } : {}) }))
    if (Object.keys(embed).length) result.embed = { color: embed.color ?? 0, ...embed }
    return result
}
export function equalPublishingContent(actual: C.PublishingContent, expected: C.PublishingContent) {
    const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,normalize(v)])) : value
    return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
}

export function publishingMessageContent(message: Message): C.PublishingContent | undefined {
    const embeds = message.embeds.filter((embed) => embed.type === "rich")
    if (embeds.length > 1) return undefined
    const rich = embeds[0]
    const content: C.PublishingContent = { content: message.content }
    if (rich) {
        const embed: C.PublishingEmbed = {}
        for (const field of ["title", "description", "url", "timestamp"] as const) if (rich[field] !== undefined) embed[field] = rich[field]!
        if (rich.color !== undefined) embed.color = rich.color
        if (rich.author) embed.author = { name: rich.author.name, ...(rich.author.url !== undefined ? { url: rich.author.url } : {}), ...(rich.author.iconUrl !== undefined ? { iconUrl: rich.author.iconUrl } : {}) }
        if (rich.footer) embed.footer = { text: rich.footer.text, ...(rich.footer.iconUrl !== undefined ? { iconUrl: rich.footer.iconUrl } : {}) }
        for (const field of ["image", "thumbnail"] as const) if (rich[field]) embed[field] = { url: rich[field]!.url, ...(rich[field]!.description !== undefined ? { description: rich[field]!.description } : {}) }
        if (rich.fields) embed.fields = rich.fields.map((field) => ({ name: field.name, value: field.value, inline: field.inline }))
        content.embed = embed
    }
    try { return canonicalPublishingContent(Schema.decodeUnknownSync(publishingContentSchema, { onExcessProperty: "error" })(content)) } catch { return undefined }
}
