import { cutText } from "@neonflux/contracts/common"
import type {
    GreetingsContext,
    GreetingsMemberContext,
    GreetingsRoute,
    GreetingsSettings,
} from "@neonflux/contracts/greetings"
import { PublishingContent } from "@neonflux/contracts/publishing-base"
import { Schema, type Types } from "effect"
import { publishingContent } from "./publishingDomain.ts"
import { fail, requireReadMember, ids, integer } from "./validation.ts"
export const GREETING_DAY = 86400000
export const GREETING_WINDOW = 180000
export const GREETING_NATIVE = 5000
export const GREETING_MARGIN = 5000
export const GREETING_BATCH = 32
/** How long a verified greeting waits between checks while rules verification is off, since only turning it on can change the answer */
export const GREETING_HELD = 600000
export const greetingRoutes: GreetingsRoute[] = ["welcome", "dm", "goodbye"]
export const defaultGreetings = (): GreetingsSettings => ({
    routes: {
        welcome: { revision: 1, enabled: false, timing: "join" },
        dm: { revision: 1, enabled: false, timing: "join" },
        goodbye: { revision: 1, enabled: false, timing: "join" },
    },
    claimsPerMinute: 10,
    retentionDays: 30,
})
export const greetingMember = (member: GreetingsMemberContext): GreetingsMemberContext => ({
    ...member,
    roleIds: ids(member.roleIds, 1000),
})
/** A decoded context, checked to be fresh and to name the bound member */
export function greetingContext(context: GreetingsContext, now: number, userId: string): GreetingsContext {
    requireReadMember(context, userId)
    integer(context.observedAt, now - 60000, now + 1000)
    return { ...context, member: context.member && greetingMember(context.member) }
}
function mapText(content: PublishingContent, transform: (value: string) => string): PublishingContent {
    const result: Types.DeepMutable<PublishingContent> = structuredClone(content),
        e = result.embed
    result.content = transform(result.content)
    if (e) {
        if (e.title !== undefined) e.title = transform(e.title)
        if (e.description !== undefined) e.description = transform(e.description)
        if (e.author) e.author.name = transform(e.author.name)
        if (e.footer) e.footer.text = transform(e.footer.text)
        if (e.image?.description !== undefined) e.image.description = transform(e.image.description)
        if (e.thumbnail?.description !== undefined) e.thumbnail.description = transform(e.thumbnail.description)
        for (const field of e.fields ?? []) {
            field.name = transform(field.name)
            field.value = transform(field.value)
        }
    }
    return result
}
export function greetingTemplate(value: unknown, destination: GreetingsRoute): PublishingContent {
    const result = publishingContent(value, true),
        allowed = [
            "user.name",
            "user.id",
            "user.mention",
            "server.name",
            "server.id",
            ...(destination === "dm" ? [] : ["channel.id"]),
        ]
    mapText(result, (value) => {
        for (const m of value.matchAll(/\{([^{}]+)\}/g))
            if (!allowed.includes(m[1]!)) fail(400, "Unsupported greeting placeholder")
        return value
    })
    const e = result.embed
    for (const value of [
        e?.url,
        e?.timestamp,
        e?.author?.url,
        e?.author?.iconUrl,
        e?.footer?.iconUrl,
        e?.image?.url,
        e?.thumbnail?.url,
    ])
        if (value && /[{}]/.test(value)) fail(400, "Greeting interpolation is text only")
    return result
}
export function renderGreeting(
    content: PublishingContent,
    destination: GreetingsRoute,
    serverId: string,
    member: Pick<GreetingsMemberContext, "userId" | "userName" | "serverName">,
    channelId?: string,
) {
    const escape = (value: string) => value.replace(/[\u000c\u202e]/g, "").replace(/[[\]()\\*_~`@#\-|:<>]/gu, "\\$&")
    const values: Record<string, string> = {
        "user.name": escape(member.userName),
        "user.id": member.userId,
        "user.mention": `<@${member.userId}>`,
        "server.name": escape(member.serverName),
        "server.id": serverId,
        ...(destination !== "dm" && channelId ? { "channel.id": channelId } : {}),
    }
    const template = greetingTemplate(content, destination),
        fits = Schema.is(PublishingContent)
    // A saved template is within Fluxer's limits but its filled-in text may not be. The text or the embed that would pass them has each of its texts
    // cut back to its template length, never splitting a character, so a valid template always renders
    const fill = (cut: boolean) =>
        mapText(template, (value) => {
            const filled = value.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key] ?? "")
            return cut && filled.length > value.length ? cutText(filled, value.length) : filled
        })
    const full = fill(false),
        short = fill(true),
        embed = full.embed && (fits({ content: "", embed: full.embed }) ? full.embed : short.embed!)
    const rendered = {
        content: fits({ content: full.content }) ? full.content : short.content,
        ...(embed ? { embed } : {}),
    }
    // Fluxer notifies only for mentions in the message text, so a channel greeting that mentions the member only in its embed also names them
    // in the text. A text already at its limit is sent without the added mention, since the greeting matters more than the ping
    const mention = values["user.mention"]!
    const pinged =
        destination !== "dm" &&
        !rendered.content.includes(mention) &&
        JSON.stringify(rendered.embed ?? {}).includes(mention)
    const named = pinged
        ? { ...rendered, content: rendered.content ? `${mention} ${rendered.content}` : mention }
        : rendered
    return publishingContent(Schema.is(PublishingContent)(named) ? named : rendered, true)
}
