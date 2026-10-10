import type { GreetingsContext, GreetingsMemberContext, GreetingsRoute, GreetingsSettings } from "@neonflux/contracts/greetings"
import type { PublishingContent } from "@neonflux/contracts/publishing-base"
import type { Types } from "effect"
import { publishingContent } from "./publishingDomain.ts"
import { fail, requireReadMember, ids, integer } from "./validation.ts"
export const GREETING_DAY = 86400000
export const GREETING_WINDOW = 180000
export const GREETING_NATIVE = 5000
export const GREETING_MARGIN = 5000
export const GREETING_BATCH = 32
export const greetingRoutes: GreetingsRoute[] = ["welcome", "dm", "goodbye"]
export const defaultGreetings = (): GreetingsSettings => ({ routes: { welcome: { revision: 1, enabled: false, timing: "join" }, dm: { revision: 1, enabled: false, timing: "join" }, goodbye: { revision: 1, enabled: false, timing: "join" } }, claimsPerMinute: 10, retentionDays: 30 })
export const greetingMember = (member: GreetingsMemberContext): GreetingsMemberContext => ({ ...member, roleIds: ids(member.roleIds, 1000) })
/** A decoded context, checked to be fresh and to name the bound member */
export function greetingContext(context: GreetingsContext, now: number, userId: string): GreetingsContext {
    requireReadMember(context, userId); integer(context.observedAt, now - 60000, now + 1000)
    return { ...context, member: context.member && greetingMember(context.member) }
}
function mapText(content: PublishingContent, transform: (value: string) => string): PublishingContent {
    const result: Types.DeepMutable<PublishingContent> = structuredClone(content), e = result.embed
    result.content = transform(result.content)
    if (e) {
        if (e.title !== undefined) e.title = transform(e.title)
        if (e.description !== undefined) e.description = transform(e.description)
        if (e.author) e.author.name = transform(e.author.name)
        if (e.footer) e.footer.text = transform(e.footer.text)
        if (e.image?.description !== undefined) e.image.description = transform(e.image.description)
        if (e.thumbnail?.description !== undefined) e.thumbnail.description = transform(e.thumbnail.description)
        for (const field of e.fields ?? []) { field.name = transform(field.name); field.value = transform(field.value) }
    }
    return result
}
export function greetingTemplate(value: unknown, destination: GreetingsRoute): PublishingContent {
    const result = publishingContent(value, true), allowed = ["user.name", "user.id", "user.mention", "server.name", "server.id", ...(destination === "dm" ? [] : ["channel.id"])]
    mapText(result, value => { for (const m of value.matchAll(/\{([^{}]+)\}/g)) if (!allowed.includes(m[1]!)) fail(400, "Unsupported greeting placeholder"); return value })
    const e = result.embed
    for (const value of [e?.url, e?.timestamp, e?.author?.url, e?.author?.iconUrl, e?.footer?.iconUrl, e?.image?.url, e?.thumbnail?.url]) if (value && /[{}]/.test(value)) fail(400, "Greeting interpolation is text only")
    return result
}
export function renderGreeting(content: PublishingContent, destination: GreetingsRoute, serverId: string, member: Pick<GreetingsMemberContext, "userId" | "userName" | "serverName">, channelId?: string) {
    const escape = (value: string) => value.replace(/[\u000c\u202e]/g, "").replace(/[\[\]()\\*_~`@#\-|:<>]/gu, "\\$&")
    const values: Record<string, string> = { "user.name": escape(member.userName), "user.id": member.userId, "user.mention": `<@${member.userId}>`, "server.name": escape(member.serverName), "server.id": serverId, ...(destination !== "dm" && channelId ? { "channel.id": channelId } : {}) }
    return publishingContent(mapText(greetingTemplate(content, destination), value => value.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key] ?? "")), true)
}
