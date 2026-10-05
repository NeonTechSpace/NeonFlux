import { issuePath } from "@neonflux/contracts/common"
import { PublishingContent, deliverablePublishingContent } from "@neonflux/contracts/publishing-base"
import { RESPONSE_PLACEHOLDERS, ResponseReplyInput } from "@neonflux/contracts/responses"
import type { ResponseReply } from "@neonflux/contracts/responses"
import { FormInputError } from "./settings-form"

// The form adapter for message content. The shared publishing and response schemas decide what is valid, as the backend does,
// and these lines only name the field to fix in the form's words
function fail(message: string): never {
    throw new FormInputError(message)
}
const urlRule = "Use an HTTP or HTTPS URL without credentials"
const embedRules: Record<string, string> = {
    title: "Embed title supports up to 256 characters",
    description: "Embed description supports up to 4096 characters",
    url: urlRule,
    color: "Embed color must be an integer between 0 and 16777215",
    timestamp: "Use a valid calendar timestamp in ISO format with a timezone",
    fields: "An embed supports up to twenty-five fields",
}
const partRules: Record<string, string> = {
    "author.name": "Use author name text of up to 256 characters, with a nonempty value",
    "footer.text": "Use footer text of up to 2048 characters, with a nonempty value",
    "image.description": "Use an image description of up to 4096 characters, with a nonempty value",
    "thumbnail.description": "Use a thumbnail description of up to 4096 characters, with a nonempty value",
}
const unsupported = "Message JSON contains unsupported or missing properties"
function messageIssue(path: ReadonlyArray<PropertyKey>, value: unknown): string {
    const [first, second, third, fourth] = path.map(String)
    if (first === undefined) return "Message JSON must use objects"
    if (first === "content") return "Message text supports up to 2000 characters"
    if (first !== "embed") return unsupported
    if (second === undefined)
        return value && typeof value === "object" && typeof (value as { embed?: unknown }).embed === "object"
            ? "Embed text exceeds six thousand characters"
            : "Message JSON must use objects"
    if (third === undefined) return embedRules[second] ?? unsupported
    if (second === "fields") {
        const field = Number(third) + 1
        return fourth === "name"
            ? `Use field ${field} name text of up to 256 characters, with a nonempty value`
            : fourth === "value"
              ? `Field ${field} value supports up to 1024 characters`
              : fourth === "inline"
                ? "Field inline must be true or false"
                : unsupported
    }
    return third === "url" || third === "iconUrl" ? urlRule : (partRules[`${second}.${third}`] ?? unsupported)
}
function replyIssue(path: ReadonlyArray<PropertyKey>): string {
    const field = path.map(String).join(".")
    if (!field) return `Use only these placeholders: ${RESPONSE_PLACEHOLDERS.map((name) => `{${name}}`).join(", ")}`
    if (field === "text") return "Add response message text of up to 2000 characters"
    if (field === "embed.title") return "Response embed title supports up to 256 characters"
    if (field === "embed.description") return "Add a response embed description of up to 4000 characters"
    return embedRules[field.replace("embed.", "")] ?? unsupported
}
/** Checks message content with the shared publishing schema. A deliverable message also needs text or meaningful embed content */
export function validateMessage(value: unknown, deliverable = true): PublishingContent {
    const path = issuePath(PublishingContent, value)
    if (path) fail(messageIssue(path, value))
    const message = value as PublishingContent
    if (deliverable && !deliverablePublishingContent(message)) fail("Add message text or meaningful embed content")
    return message
}
export function importMessage(json: string): PublishingContent {
    let value: unknown
    try {
        value = JSON.parse(json)
    } catch {
        fail("Message JSON is invalid")
    }
    return validateMessage(value, false)
}
// The builder edits a response as message content, which maps to the reply the backend stores
function responseReply(message: PublishingContent): ResponseReply {
    const embed = message.embed
    if (!embed) return { type: "text", text: message.content }
    if (Object.keys(embed).some((key) => !["title", "description", "color"].includes(key)))
        fail("Response embeds support title, description and color only")
    if (message.content)
        fail("Choose message text or an embed for this response. Clear the message text to use an embed")
    return {
        type: "embed",
        embed: {
            title: embed.title ?? "",
            description: embed.description ?? "",
            ...(embed.color !== undefined ? { color: embed.color } : {}),
        },
    }
}
/** Checks response content. A deliverable response also passes the shared reply schema, including its placeholders */
export function validateResponseMessage(value: unknown, deliverable = true): PublishingContent {
    const message = validateMessage(value, false),
        reply = responseReply(message)
    const path = deliverable ? issuePath(ResponseReplyInput, reply) : undefined
    if (path) fail(replyIssue(path))
    return message
}
export function responseMessage(json: string): ResponseReply {
    return responseReply(validateResponseMessage(importMessage(json)))
}
export function responseReplyMessage(reply: ResponseReply): PublishingContent {
    return reply.type === "text" ? { content: reply.text } : { content: "", embed: { ...reply.embed } }
}
