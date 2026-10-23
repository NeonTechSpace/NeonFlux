import { Schema } from "effect"
import type { PublishingContent } from "@neonflux/contracts/publishing-base"
import {
    PROFILE_BIO,
    ProfileContent,
    type ProfileOperation,
    type ProfileMemberOperation,
} from "@neonflux/contracts/profiles"
import { memberAccessOperation } from "./memberAccess.ts"
import { memberLinks, memberText, neutralMentions } from "./memberContent.ts"
import { decode, fail } from "./validation.ts"

// The feature name in the shared member access lists, and the job family of website requests
export const PROFILE_FEATURE = "profile",
    PROFILE_FAMILY = "member-profile"

export function profileOperation(op: ProfileOperation, dashboard = false): ProfileOperation {
    return op.type === "settings" ? op : memberAccessOperation(op, dashboard)
}
// The website's request as sent. memberText and memberLinks then trim and check each field with the message the website shows
const saveInput = Schema.Struct({
    type: Schema.Unknown,
    bio: Schema.Unknown,
    links: Schema.Unknown,
    color: Schema.Unknown,
})
export function profileMemberOperation(value: unknown): ProfileMemberOperation {
    const input = decode(
        saveInput,
        decode(Schema.Record(Schema.String, Schema.Unknown), value),
        "Invalid publishing input",
    )
    if (input.type !== "save") fail(400, "Unsupported profile request")
    return {
        type: "save",
        bio: memberText(input.bio, PROFILE_BIO, "The bio", { multiline: true, empty: true }),
        links: memberLinks(input.links),
        color: decode(ProfileContent.fields.color, input.color),
    }
}
/** What automod reads: the bio and the links */
export const profileText = (content: ProfileContent) => [content.bio, ...content.links].join("\n")
const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]
/** A stored MM-DD birthday as its month name and day, such as March 3. Never a year or an age */
export const birthdayText = (monthDay: string) =>
    `${months[Number(monthDay.slice(0, 2)) - 1]} ${Number(monthDay.slice(3))}`
/**
 * The reply to !profile: An embed with the member's name, the bio and the links in the accent color, without mentions. A level line
 * such as Level 12, rank #40 and a birthday such as March 3 follow when the caller found them
 */
export function renderProfile(
    content: ProfileContent,
    userName: string,
    extra: { level?: string; birthday?: string } = {},
): PublishingContent {
    const description = [neutralMentions(content.bio), ...content.links].filter((part) => part.length).join("\n\n"),
        fields = [
            ...(extra.level ? [{ name: "Level", value: extra.level }] : []),
            ...(extra.birthday ? [{ name: "Birthday", value: extra.birthday }] : []),
        ]
    return {
        content: "",
        embed: {
            title: neutralMentions(userName),
            description: description || "No bio yet",
            ...(content.color !== null ? { color: content.color } : {}),
            ...(fields.length ? { fields } : {}),
        },
    }
}
