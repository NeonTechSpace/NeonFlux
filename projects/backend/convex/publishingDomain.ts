import { PublishingContent, PublishingKind, deliverablePublishingContent } from "@neonflux/contracts/publishing-base"
import { PublishingDraftEdit } from "@neonflux/contracts/publishing"
import { decode, fail, integer, name } from "./validation.ts"

export const PUBLISHING_DAY = 86400000
export const PUBLISHING_BATCH = 32
// Content is canonicalized as the contracts do, so a stored canonical copy and the bot's check always agree
export { canonicalPublishingContent } from "@neonflux/contracts/publishing-base"
export function publishingContent(value: unknown, deliverable = false): PublishingContent {
    const result = decode(PublishingContent, value, "Invalid publishing content")
    if (deliverable && !deliverablePublishingContent(result)) fail(400, "Publishing content is empty")
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
