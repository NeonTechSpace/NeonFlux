import type { GreetingsContext, GreetingsMemberContext, GreetingsRoute, GreetingsSettings, PublishingContent } from "../contracts.js"
import { publishingContent, shape } from "./publishingDomain.ts"
import { epoch } from "./rolesDomain.ts"
import { fail, requireId, requireReadMember, bool, ids, integer, text } from "./validation.ts"
export const GREETING_DAY = 86400000
export const GREETING_WINDOW = 180000
export const GREETING_NATIVE = 5000
export const GREETING_MARGIN = 5000
export const GREETING_BATCH = 32
export const greetingRoutes: GreetingsRoute[] = ["welcome", "dm", "goodbye"]
export const defaultGreetings = (): GreetingsSettings => ({ routes: { welcome: { revision: 1, enabled: false, timing: "join" }, dm: { revision: 1, enabled: false, timing: "join" }, goodbye: { revision: 1, enabled: false, timing: "join" } }, claimsPerMinute: 10, retentionDays: 30 })
export function route(value: unknown): GreetingsRoute { if (value !== "welcome" && value !== "dm" && value !== "goodbye") fail(400, "Invalid greeting route"); return value }
export function greetingMember(value: unknown): GreetingsMemberContext {
    const r = shape(value, ["userId", "userName", "serverName", "joinedAt", "isBot", "roleIds", "timeoutUntil"], ["userId", "userName", "serverName", "joinedAt", "isBot", "roleIds", "timeoutUntil"])
    return { userId: requireId(r.userId), userName: text(r.userName, 128), serverName: text(r.serverName, 128), joinedAt: epoch(r.joinedAt), isBot: bool(r.isBot), roleIds: ids(r.roleIds, 1000), timeoutUntil: r.timeoutUntil === null ? null : epoch(r.timeoutUntil) }
}
export function greetingContext(value: unknown, now: number, userId: string): GreetingsContext {
    const r = shape(value, ["botId", "botAuthorized", "observedAt", "member", "memberAbsent", "memberUserId", "channelId"], ["botId", "botAuthorized", "observedAt", "member", "memberAbsent"])
    requireReadMember(r, userId)
    const member = r.member === null ? null : greetingMember(r.member), memberAbsent = bool(r.memberAbsent)
    if ((member === null) !== memberAbsent) fail(400, "Invalid membership observation")
    return { botId: requireId(r.botId), botAuthorized: bool(r.botAuthorized), observedAt: integer(r.observedAt, now - 60000, now + 1000), member, memberAbsent, ...(r.memberUserId !== undefined ? { memberUserId: requireId(r.memberUserId) } : {}), ...(r.channelId !== undefined ? { channelId: requireId(r.channelId) } : {}) }
}
export function greetingCursor(value: unknown): string | null { if (value === undefined) return null; if (typeof value !== "string" || !value.length || value.length > 4096) fail(400, "Invalid cursor"); return value }
function mapText(content: PublishingContent, transform: (value: string) => string): PublishingContent {
    const result = structuredClone(content), e = result.embed
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
