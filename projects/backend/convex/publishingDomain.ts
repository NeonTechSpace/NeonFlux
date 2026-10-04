import type { PublishingContent, PublishingEmbed, PublishingKind } from "../contracts.js"
import { fail, object, integer, name } from "./validation.ts"

export const PUBLISHING_DAY = 86400000
export const PUBLISHING_BATCH = 32
export const effectiveText = (value: string) => value.replace(/[\u000c\u202e]/g, "").trim()
export function shape(value: unknown, keys: string[], required: string[] = []): Record<string, unknown> {
    const row = object(value)
    if (Object.keys(row).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(row, key))) fail(400, "Invalid publishing input")
    return row
}
function string(value: unknown, max: number, nonempty = false) {
    if (typeof value !== "string" || value.length > max || nonempty && !effectiveText(value)) fail(400, "Invalid publishing text")
    return value
}
function url(value: unknown) {
    const text = string(value, 2048, true)
    try { const parsed = new URL(text); if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.href.length > 2048) fail(400, "Invalid publishing URL") }
    catch { fail(400, "Invalid publishing URL") }
    return text
}
function timestamp(value: unknown) {
    const text = string(value, 128)
    const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(text)
    if (!match || !Number.isFinite(Date.parse(text))) fail(400, "Invalid publishing timestamp")
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    if (month < 1 || month > 12 || day < 1 || day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!) fail(400, "Invalid publishing timestamp")
    return text
}
function label(value: unknown, footer = false) {
    const key = footer ? "text" : "name"
    const row = shape(value, [key, "url", "iconUrl"], [key])
    if (footer && row.url !== undefined) fail(400, "Invalid footer")
    return { [key]: string(row[key], footer ? 2048 : 256, true), ...(row.url !== undefined ? { url: url(row.url) } : {}), ...(row.iconUrl !== undefined ? { iconUrl: url(row.iconUrl) } : {}) }
}
function media(value: unknown) {
    const row = shape(value, ["url", "description"], ["url"])
    return { url: url(row.url), ...(row.description !== undefined ? { description: string(row.description, 4096, true) } : {}) }
}
export function publishingField(value: unknown) {
    const row = shape(value, ["name", "value", "inline"], ["name", "value"])
    if (row.inline !== undefined && typeof row.inline !== "boolean") fail(400, "Invalid publishing field")
    return { name: string(row.name, 256, true), value: string(row.value, 1024), ...(row.inline !== undefined ? { inline: row.inline as boolean } : {}) }
}
export function publishingEmbed(value: unknown): PublishingEmbed {
    const row = shape(value, ["title", "description", "url", "color", "timestamp", "author", "footer", "image", "thumbnail", "fields"])
    if (row.fields !== undefined && (!Array.isArray(row.fields) || row.fields.length > 25)) fail(400, "Invalid publishing fields")
    const embed: PublishingEmbed = {
        ...(row.title !== undefined ? { title: string(row.title, 256) } : {}),
        ...(row.description !== undefined ? { description: string(row.description, 4096, row.description !== "") } : {}),
        ...(row.url !== undefined ? { url: url(row.url) } : {}), ...(row.color !== undefined ? { color: integer(row.color, 0, 0xffffff) } : {}),
        ...(row.timestamp !== undefined ? { timestamp: timestamp(row.timestamp) } : {}),
        ...(row.author !== undefined ? { author: label(row.author) as NonNullable<PublishingEmbed["author"]> } : {}),
        ...(row.footer !== undefined ? { footer: label(row.footer, true) as NonNullable<PublishingEmbed["footer"]> } : {}),
        ...(row.image !== undefined ? { image: media(row.image) } : {}), ...(row.thumbnail !== undefined ? { thumbnail: media(row.thumbnail) } : {}),
        ...(row.fields !== undefined ? { fields: (row.fields as unknown[]).map(publishingField) } : {}),
    }
    const total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.author?.name.length ?? 0) + (embed.footer?.text.length ?? 0)
        + (embed.image?.description?.length ?? 0) + (embed.thumbnail?.description?.length ?? 0) + (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
    if (total > 6000) fail(400, "Publishing embed text exceeds 6000 characters")
    return embed
}
export function publishingContent(value: unknown, deliverable = false): PublishingContent {
    const row = shape(value, ["content", "embed"], ["content"])
    const result = { content: string(row.content, 2000), ...(row.embed !== undefined ? { embed: publishingEmbed(row.embed) } : {}) }
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
    const result: PublishingContent = { content: effectiveText(value.content), ...(embed ? { embed: {
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
export function publishingKind(value: unknown): PublishingKind { if (value !== "draft" && value !== "template") fail(400, "Invalid publishing kind"); return value }
export const publishingName = name
export function editPublishingContent(current: PublishingContent, value: unknown): PublishingContent {
    const edit = object(value); const next = structuredClone(current)
    if (edit.type === "content") { shape(edit, ["type", "content"], ["type", "content"]); next.content = string(edit.content, 2000) }
    else if (edit.type === "embed") { shape(edit, ["type", "embed"], ["type", "embed"]); next.embed = publishingEmbed(edit.embed) }
    else if (edit.type === "embed-clear") { shape(edit, ["type"]); delete next.embed }
    else if (edit.type === "embed-property") {
        shape(edit, ["type", "field", "value"], ["type", "field", "value"])
        if (!["title", "description", "url", "color", "timestamp", "author", "footer", "image", "thumbnail"].includes(String(edit.field))) fail(400, "Invalid publishing field")
        const embed = next.embed ?? {}; const key = edit.field as Exclude<keyof PublishingEmbed, "fields">
        if (edit.value === null) delete embed[key]
        else Object.assign(embed, { [key]: edit.value })
        next.embed = publishingEmbed(embed)
    } else if (["field-add", "field-set", "field-remove", "fields-clear"].includes(String(edit.type))) {
        const allowed = edit.type === "field-add" ? ["type", "field"] : edit.type === "field-set" ? ["type", "index", "field"] : edit.type === "field-remove" ? ["type", "index"] : ["type"]
        shape(edit, allowed, allowed)
        const fields = next.embed?.fields ?? []
        if (edit.type === "field-add") fields.push(publishingField(edit.field))
        else if (edit.type === "fields-clear") fields.splice(0)
        else { const index = integer(edit.index, 1, fields.length) - 1; if (edit.type === "field-remove") fields.splice(index, 1); else fields[index] = publishingField(edit.field) }
        next.embed = { ...next.embed, fields }
    } else fail(400, "Invalid publishing edit")
    return publishingContent(next)
}
