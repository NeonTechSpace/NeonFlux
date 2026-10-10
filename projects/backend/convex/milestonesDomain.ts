import { ConvexError } from "convex/values"
import type { CivilFoldPolicy } from "@neonflux/contracts/civil"
import { MilestonesCivil, MilestonesDeliveryContext, MilestonesMonthDay, MilestonesParticipantContext } from "@neonflux/contracts/milestones"
import { MilestonesKind, type PublishingContent } from "@neonflux/contracts/publishing-base"
import { resolveCivilInstant } from "./civilDomain.ts"

import { publishingContent } from "./publishingDomain.ts"
import { decode, fail, integer } from "./validation.ts"
import { eventMember } from "./publishingContext.ts"
import { automationContext, recentObservation } from "./schedulesDomain.ts"

export { MILESTONES_BATCH } from "@neonflux/contracts/milestones"
export const MILESTONES_DAY = 86400000
export const advanceMilestone = (n: number) => integer(n + 1, 1, Number.MAX_SAFE_INTEGER)
export const milestoneKind = (value: unknown): MilestonesKind => decode(MilestonesKind, value, "Invalid milestone kind")
export const milestoneMonthDay = (value: unknown): string => decode(MilestonesMonthDay, value, "Birthday requires valid MM-DD only")
// A changed zone or time must resolve on an ordinary day in the zone database
export function milestoneCivil(value: { zone: unknown, time: unknown, fold: unknown }): { zone: string, time: string, fold: CivilFoldPolicy } {
    const civil = decode(MilestonesCivil, value, "Explicit IANA timezone, HH:mm and fold policy required")
    resolveCivilInstant(`2026-01-15T${civil.time}`, civil.zone, civil.fold)
    return civil
}
export function milestoneParticipant(value: unknown): MilestonesParticipantContext {
    const participant = decode(MilestonesParticipantContext, value)
    recentObservation(participant.observedAt)
    return { ...participant, member: eventMember(participant.member, participant.observedAt) }
}
export function milestoneDeliveryContext(value: unknown): MilestonesDeliveryContext {
    const context = decode(MilestonesDeliveryContext, value)
    return { automation: automationContext(context.automation), participant: milestoneParticipant(context.participant) }
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
