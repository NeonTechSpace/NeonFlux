import { Schema } from "effect"
import { Int } from "@neonflux/contracts/common"
import type { PublishingContent } from "@neonflux/contracts/publishing-base"
import { SHOWCASE_TEXT, SHOWCASE_TITLE, ShowcaseOperation, type ShowcaseContent, type ShowcaseMemberOperation } from "@neonflux/contracts/showcases"
import { memberAccessOperation } from "./memberAccess.ts"
import { memberLinks, memberText, neutralMentions } from "./memberContent.ts"
import { decode, fail } from "./validation.ts"

// The feature name in the shared member access lists, and the job family of website requests
export const SHOWCASE_FEATURE = "showcase", SHOWCASE_FAMILY = "member-showcase"
// The member view shows this many of a member's showcases, the most a per-member cap allows
export const SHOWCASE_MEMBER_VIEW = 50

export function showcaseOperation(value: unknown, dashboard = false): ShowcaseOperation {
    const op = decode(ShowcaseOperation, value)
    return op.type === "settings" ? op : memberAccessOperation(op, dashboard)
}
// The website's request as sent. memberText and memberLinks then trim and check each field with the message the website shows
const createInput = Schema.Struct({ type: Schema.Literal("create"), title: Schema.Unknown, text: Schema.Unknown, links: Schema.Unknown })
const editInput = Schema.Struct({ ...createInput.fields, type: Schema.Literal("edit"), showcaseNo: Schema.Unknown })
const deleteInput = Schema.Struct({ type: Schema.Literal("delete"), showcaseNo: Schema.Unknown })
function showcaseContent(input: { title: unknown, text: unknown, links: unknown }): ShowcaseContent {
    return { title: memberText(input.title, SHOWCASE_TITLE, "The title"), text: memberText(input.text, SHOWCASE_TEXT, "The text", { multiline: true }), links: memberLinks(input.links) }
}
export function showcaseMemberOperation(value: unknown): ShowcaseMemberOperation {
    const input = decode(Schema.Record(Schema.String, Schema.Unknown), value)
    if (input.type === "create") return { type: "create", ...showcaseContent(decode(createInput, input, "Invalid publishing input")) }
    if (input.type === "edit") { const edit = decode(editInput, input, "Invalid publishing input"); return { type: "edit", showcaseNo: decode(Int(1), edit.showcaseNo), ...showcaseContent(edit) } }
    if (input.type === "delete") return { type: "delete", showcaseNo: decode(Int(1), decode(deleteInput, input, "Invalid publishing input").showcaseNo) }
    fail(400, "Unsupported showcase request")
}
/** What automod reads: the title, the text and the links */
export const showcaseText = (content: ShowcaseContent) => [content.title, content.text, ...content.links].join("\n")
// The first HTTPS link to a PNG, JPEG, GIF or WebP file becomes the embed image. NeonFlux never fetches it
const imageLink = (links: readonly string[]) => links.find(link => { const url = new URL(link); return url.protocol === "https:" && /\.(?:png|jpe?g|gif|webp)$/i.test(url.pathname) })
/** The bot's post: An embed with the member's name, the title, the text and the links, without mentions */
export function renderShowcase(content: ShowcaseContent, userName: string): PublishingContent {
    const image = imageLink(content.links)
    return { content: "", embed: { title: neutralMentions(content.title), description: [neutralMentions(content.text), ...content.links].join("\n\n"),
        author: { name: neutralMentions(userName) }, ...(image ? { image: { url: image } } : {}) } }
}
