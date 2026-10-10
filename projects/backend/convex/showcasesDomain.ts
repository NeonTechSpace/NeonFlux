import type { PublishingContent, ShowcaseContent, ShowcaseMemberOperation, ShowcaseOperation } from "../contracts.js"
import { memberAccessOperation } from "./memberAccess.ts"
import { memberLinks, memberText, neutralMentions } from "./memberContent.ts"
import { shape } from "./publishingDomain.ts"
import { bool, fail, integer, object, requireId } from "./validation.ts"

// The feature name in the shared member access lists, and the job family of website requests
export const SHOWCASE_FEATURE = "showcase", SHOWCASE_FAMILY = "member-showcase"
export const SHOWCASE_TITLE = 100, SHOWCASE_TEXT = 1000, SHOWCASE_MAX_PER_MEMBER = 50, SHOWCASE_MAX_INTERVAL_MINUTES = 10080
// The member view shows this many of a member's showcases, the most a per-member cap allows
export const SHOWCASE_MEMBER_VIEW = 50

export function showcaseOperation(value: unknown, dashboard = false): ShowcaseOperation {
    const input = object(value)
    if (input.type !== "settings") return memberAccessOperation(input, dashboard)
    shape(input, ["type", "enabled", "channelId", "maxPerMember", "intervalMinutes"], ["type"])
    if (Object.keys(input).length === 1) fail(400, "Choose a showcase setting")
    return {
        type: "settings",
        ...(input.enabled === undefined ? {} : { enabled: bool(input.enabled) }),
        ...(input.channelId === undefined ? {} : { channelId: input.channelId === null ? null : requireId(input.channelId) }),
        ...(input.maxPerMember === undefined ? {} : { maxPerMember: input.maxPerMember === null ? null : integer(input.maxPerMember, 1, SHOWCASE_MAX_PER_MEMBER) }),
        ...(input.intervalMinutes === undefined ? {} : { intervalMinutes: input.intervalMinutes === null ? null : integer(input.intervalMinutes, 1, SHOWCASE_MAX_INTERVAL_MINUTES) }),
    }
}
function showcaseContent(input: Record<string, unknown>): ShowcaseContent {
    return { title: memberText(input.title, SHOWCASE_TITLE, "The title"), text: memberText(input.text, SHOWCASE_TEXT, "The text", { multiline: true }), links: memberLinks(input.links) }
}
export function showcaseMemberOperation(value: unknown): ShowcaseMemberOperation {
    const input = object(value)
    if (input.type === "create") { shape(input, ["type", "title", "text", "links"], ["type", "title", "text", "links"]); return { type: "create", ...showcaseContent(input) } }
    if (input.type === "edit") {
        shape(input, ["type", "showcaseNo", "title", "text", "links"], ["type", "showcaseNo", "title", "text", "links"])
        return { type: "edit", showcaseNo: integer(input.showcaseNo, 1, Number.MAX_SAFE_INTEGER), ...showcaseContent(input) }
    }
    if (input.type === "delete") { shape(input, ["type", "showcaseNo"], ["type", "showcaseNo"]); return { type: "delete", showcaseNo: integer(input.showcaseNo, 1, Number.MAX_SAFE_INTEGER) } }
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
