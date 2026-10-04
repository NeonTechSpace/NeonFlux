import { ConvexError } from "convex/values"
import type { CivilFoldPolicy, MilestonesDeliveryBinding, MilestonesDeliveryContext, MilestonesDmIdentity, MilestonesKind, MilestonesParticipantContext, PublishingContent } from "../contracts.js"
import { resolveCivilInstant } from "./civilDomain.ts"

import { publishingContent, shape } from "./publishingDomain.ts"
import { fail, requireId, integer, text, token } from "./validation.ts"
import { eventMember } from "./publishingContext.ts"
import { automationContext } from "./schedulesDomain.ts"

export const MILESTONES_DAY = 86400000
export const MILESTONES_BATCH = 20
export const advanceMilestone = (n: number) => integer(n + 1, 1, Number.MAX_SAFE_INTEGER)
export function milestoneKind(value: unknown): MilestonesKind { if (value !== "birthday" && value !== "anniversary") fail(400, "Invalid milestone kind"); return value }
export function milestoneMonthDay(value: unknown) {
    if (typeof value !== "string" || !/^\d\d-\d\d$/.test(value)) fail(400, "Birthday requires valid MM-DD only")
    const date = new Date(`2000-${value}T00:00:00Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(5, 10) !== value) fail(400, "Birthday requires valid MM-DD only")
    return value
}
export function milestoneCivil(value: { zone: unknown, time: unknown, fold: unknown }): { zone: string, time: string, fold: CivilFoldPolicy } {
    if (typeof value.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)) fail(400, "Explicit HH:mm required")
    if (value.fold !== "earlier" && value.fold !== "later" && value.fold !== "reject") fail(400, "Explicit fold policy required")
    if (typeof value.zone !== "string") fail(400, "IANA timezone required")
    resolveCivilInstant(`2026-01-15T${value.time}`, value.zone, value.fold)
    return { zone: value.zone, time: value.time, fold: value.fold }
}
export function milestoneIdentity(value: unknown): MilestonesDmIdentity {
    const r = shape(value, ["userId", "channelId", "isDirectMessage", "isBot", "observedAt"], ["userId", "channelId", "isDirectMessage", "isBot", "observedAt"])
    if (r.isDirectMessage !== true || r.isBot !== false) fail(403, "Verified one-to-one human DM required")
    return { userId: requireId(r.userId), channelId: requireId(r.channelId), isDirectMessage: true, isBot: false, observedAt: integer(r.observedAt, Math.max(0, Date.now() - 60000), Date.now() + 1000) }
}
export function milestoneParticipant(value: unknown): MilestonesParticipantContext {
    const r = shape(value, ["observedAt", "channelId", "botId", "member", "userName", "serverName"], ["observedAt", "channelId", "botId", "member", "userName", "serverName"])
    const observedAt = integer(r.observedAt, Math.max(0, Date.now() - 60000), Date.now() + 1000)
    return { observedAt, channelId: requireId(r.channelId), botId: requireId(r.botId), member: eventMember(r.member, observedAt), userName: text(r.userName, 100), serverName: text(r.serverName, 100) }
}
export function milestoneDeliveryContext(value: unknown): MilestonesDeliveryContext {
    const r = shape(value, ["automation", "participant"], ["automation", "participant"])
    return { automation: automationContext(r.automation), participant: milestoneParticipant(r.participant) }
}
export function milestoneBinding(value: unknown): MilestonesDeliveryBinding {
    const r = shape(value, ["type", "deliveryId", "kind", "intentRevision", "userId", "joinedAt", "consentRevision", "audienceGeneration", "celebrationYear", "completedYears", "generation"], ["deliveryId", "kind", "intentRevision", "userId", "joinedAt", "consentRevision", "audienceGeneration", "celebrationYear", "completedYears", "generation"])
    if (r.type !== undefined && r.type !== "milestone") fail(400, "Invalid milestone consumer")
    if (typeof r.joinedAt !== "string") fail(400, "Raw membership epoch required")
    return { deliveryId: token(r.deliveryId), kind: milestoneKind(r.kind), userId: requireId(r.userId), joinedAt: r.joinedAt, intentRevision: integer(r.intentRevision, 1, Number.MAX_SAFE_INTEGER), consentRevision: integer(r.consentRevision, 1, Number.MAX_SAFE_INTEGER), audienceGeneration: integer(r.audienceGeneration, 1, Number.MAX_SAFE_INTEGER), celebrationYear: integer(r.celebrationYear, 1, 9999), completedYears: integer(r.completedYears, 0, 9999), generation: integer(r.generation, 1, Number.MAX_SAFE_INTEGER) }
}
export function milestoneLocalParts(instant: number, zone: string) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant).map(x => [x.type, x.value]))
    return { year: Number(p.year), monthDay: `${p.month}-${p.day}`, minute: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` }
}
export function milestoneAnnual(kind: MilestonesKind, joinedAt: string, monthDay: string | undefined, route: { zone: string, time: string, fold: CivilFoldPolicy }, year: number) {
    const joined = milestoneLocalParts(Date.parse(joinedAt), route.zone), completedYears = kind === "anniversary" ? year - joined.year : 0
    let date = kind === "birthday" ? milestoneMonthDay(monthDay) : joined.monthDay
    if (date === "02-29" && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) date = "02-28"
    const localMinute = `${String(year).padStart(4, "0")}-${date}T${route.time}`
    try { return { celebrationYear: year, completedYears, ...resolveCivilInstant(localMinute, route.zone, route.fold) } }
    catch (error) {
        if (!(error instanceof ConvexError) || typeof error.data !== "object" || error.data === null || !("error" in error.data)) throw error
        const reason = error.data.error === "Nonexistent local time" ? "civil-gap" : error.data.error === "Ambiguous local time requires earlier or later" ? "civil-fold" : undefined
        if (!reason) throw error
        // A skipped civil minute has no instant. Use its civil date only as an internal terminal ordering fence
        return { celebrationYear: year, completedYears, instantAt: Date.parse(`${localMinute}Z`), offsetMinutes: 0, reason: reason as "civil-gap" | "civil-fold" }
    }
}
const escaped = (value: string) => value.replace(/[\\`*_{}[\]()<>#|~@]/g, "\\$&")
export function validateMilestoneTemplate(content: PublishingContent, kind: MilestonesKind) {
    const raw = JSON.stringify(content)
    for (const match of raw.matchAll(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g)) if (!["user", "server", ...(kind === "anniversary" ? ["years"] : [])].includes(match[1]!)) fail(400, "Unsupported milestone template placeholder")
    for (const media of [content.embed?.image, content.embed?.thumbnail]) if (media?.url.includes("{")) fail(400, "Milestone media must be static")
    for (const url of [content.embed?.url, content.embed?.author?.url, content.embed?.author?.iconUrl, content.embed?.footer?.iconUrl]) if (url?.includes("{")) fail(400, "Milestone URLs must be static")
}
export function renderMilestone(content: PublishingContent, kind: MilestonesKind, userName: string, serverName: string, completedYears: number): PublishingContent {
    validateMilestoneTemplate(content, kind)
    const values: Record<string, string> = { user: escaped(userName), server: escaped(serverName), years: String(completedYears) }
    const render = (value: unknown): unknown => typeof value === "string" ? value.replace(/\{(user|server|years)\}/g, (_, key: string) => values[key]!) : Array.isArray(value) ? value.map(render) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item)])) : value
    const rendered = render(content) as PublishingContent
    const label = kind === "birthday" ? "Birthday celebration" : `Membership anniversary (${completedYears} completed years)`
    return publishingContent({ ...rendered, content: `${label}${rendered.content ? `\n${rendered.content}` : ""}` }, true)
}
