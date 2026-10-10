import { PublishingContent, PublishingKind, type PublishingEmbed } from "@neonflux/contracts/publishing-base"
import { PublishingDraftEdit } from "@neonflux/contracts/publishing"
import { decode, fail, integer, name } from "./validation.ts"

export const PUBLISHING_DAY = 86400000
export const PUBLISHING_BATCH = 32
export const effectiveText = (value: string) => value.replace(/[\u000c\u202e]/g, "").trim()
export function publishingContent(value: unknown, deliverable = false): PublishingContent {
    const result = decode(PublishingContent, value, "Invalid publishing content")
    if (deliverable) {
        const embed = result.embed
        const meaningful = embed && (effectiveText(embed.title ?? "") || effectiveText(embed.description ?? "") || embed.author || embed.footer || embed.image || embed.thumbnail || embed.fields?.length)
        if (!effectiveText(result.content) && !meaningful) fail(400, "Publishing content is empty")
    }
    return result
}
export function canonicalPublishingContent(value: PublishingContent): PublishingContent {
    const embed = value.embed
    const cleanLabel = <T extends { url?: string, iconUrl?: string }>(row: T) => ({ ...row,
        ...(row.url ? { url: new URL(row.url).href } : {}), ...(row.iconUrl ? { iconUrl: new URL(row.iconUrl).href } : {}) })
    const result: { content: string, embed?: PublishingEmbed } = { content: effectiveText(value.content), ...(embed ? { embed: {
        ...(effectiveText(embed.title ?? "") ? { title: effectiveText(embed.title!) } : {}),
        ...(effectiveText(embed.description ?? "") ? { description: effectiveText(embed.description!) } : {}),
        ...(embed.url ? { url: new URL(embed.url).href } : {}), ...(embed.color !== undefined ? { color: embed.color } : {}),
        ...(embed.timestamp ? { timestamp: new Date(embed.timestamp).toISOString() } : {}),
        ...(embed.author ? { author: { ...cleanLabel(embed.author), name: effectiveText(embed.author.name) } } : {}),
        ...(embed.footer ? { footer: { ...cleanLabel(embed.footer), text: effectiveText(embed.footer.text) } } : {}),
        ...(embed.image ? { image: { url: new URL(embed.image.url).href, ...(embed.image.description ? { description: effectiveText(embed.image.description) } : {}) } } : {}),
        ...(embed.thumbnail ? { thumbnail: { url: new URL(embed.thumbnail.url).href, ...(embed.thumbnail.description ? { description: effectiveText(embed.thumbnail.description) } : {}) } } : {}),
        ...(embed.fields?.length ? { fields: embed.fields.map(field => ({ name: effectiveText(field.name), value: effectiveText(field.value), ...(field.inline === true ? { inline: true } : {}) })) } : {}),
    } } : {}) }
    if (result.embed && !Object.keys(result.embed).length) delete result.embed
    if (result.embed) result.embed = { color: result.embed.color ?? 0, ...result.embed }
    return result
}
export const publishingKind = (value: unknown): PublishingKind => decode(PublishingKind, value, "Invalid publishing kind")
export const publishingName = name
export function editPublishingContent(current: PublishingContent, value: unknown): PublishingContent {
    const edit = decode(PublishingDraftEdit, value, "Invalid publishing edit"), { embed, ...rest } = current
    if (edit.type === "content") return publishingContent({ ...current, content: edit.content })
    if (edit.type === "embed") return publishingContent({ ...rest, embed: edit.embed })
    if (edit.type === "embed-clear") return publishingContent(rest)
    if (edit.type === "embed-property") {
        const { [edit.field]: _, ...others } = embed ?? {}
        return publishingContent({ ...rest, embed: edit.value === null ? others : { ...others, [edit.field]: edit.value } })
    }
    const fields = [...embed?.fields ?? []]
    if (edit.type === "field-add") fields.push(edit.field)
    else if (edit.type === "fields-clear") fields.splice(0)
    else { const index = integer(edit.index, 1, fields.length) - 1; if (edit.type === "field-remove") fields.splice(index, 1); else fields[index] = edit.field }
    return publishingContent({ ...rest, embed: { ...embed, fields } })
}
