import type { ProfileContent, ProfileMemberOperation, ProfileOperation, PublishingContent } from "../contracts.js"
import { memberAccessOperation } from "./memberAccess.ts"
import { memberLinks, memberText, neutralMentions } from "./memberContent.ts"
import { shape } from "./publishingDomain.ts"
import { bool, fail, integer, object } from "./validation.ts"

// The feature name in the shared member access lists, and the job family of website requests
export const PROFILE_FEATURE = "profile", PROFILE_FAMILY = "member-profile"
export const PROFILE_BIO = 300, PROFILE_MAX_COOLDOWN_SECONDS = 3600

export function profileOperation(value: unknown, dashboard = false): ProfileOperation {
    const input = object(value)
    if (input.type !== "settings") return memberAccessOperation(input, dashboard)
    shape(input, ["type", "enabled", "cooldownSeconds"], ["type"])
    if (Object.keys(input).length === 1) fail(400, "Choose a profile setting")
    return {
        type: "settings",
        ...(input.enabled === undefined ? {} : { enabled: bool(input.enabled) }),
        ...(input.cooldownSeconds === undefined ? {} : { cooldownSeconds: input.cooldownSeconds === null ? null : integer(input.cooldownSeconds, 1, PROFILE_MAX_COOLDOWN_SECONDS) }),
    }
}
export function profileMemberOperation(value: unknown): ProfileMemberOperation {
    const input = shape(value, ["type", "bio", "links", "color"], ["type", "bio", "links", "color"])
    if (input.type !== "save") fail(400, "Unsupported profile request")
    return { type: "save", bio: memberText(input.bio, PROFILE_BIO, "The bio", { multiline: true, empty: true }), links: memberLinks(input.links),
        color: input.color === null ? null : integer(input.color, 0, 0xffffff) }
}
/** What automod reads: the bio and the links */
export const profileText = (content: ProfileContent) => [content.bio, ...content.links].join("\n")
/** The reply to !profile: An embed with the member's name, the bio and the links in the accent color, without mentions */
export function renderProfile(content: ProfileContent, userName: string): PublishingContent {
    const description = [neutralMentions(content.bio), ...content.links].filter(part => part.length).join("\n\n")
    return { content: "", embed: { title: neutralMentions(userName), description: description || "No bio yet", ...(content.color !== null ? { color: content.color } : {}) } }
}
