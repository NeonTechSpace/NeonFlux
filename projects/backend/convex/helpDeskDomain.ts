import type { HelpDeskOperation } from "../contracts.js"
import { shape } from "./publishingDomain.ts"
import { fail, requireId } from "./validation.ts"

// A server's help desk serves up to ten forum channels and keeps up to 50 saved answers
export const HELPDESK_FORUM_LIMIT = 10, HELPDESK_ANSWER_LIMIT = 50
export const HELPDESK_DEFAULT_GREETING = "Thanks for posting. Members and staff reply in this post. Send !solved once your question is answered"
export const HELPDESK_DEFAULT_TAG = "Solved", HELPDESK_DEFAULT_NUDGE_HOURS = 24
/** Reminders a work pass claims at most, so one pass stays small */
export const HELPDESK_NUDGES_PER_PASS = 25
// Thread budget passes run hourly while the guard is on, and ten minutes apart while auto-archive changes remain. Fluxer allows
// 1,000 active threads per server, and staff are warned at 900, at most once a day
export const HELPDESK_GUARD_INTERVAL_MS = 3600000, HELPDESK_GUARD_SOON_MS = 600000, HELPDESK_GUARD_THRESHOLD = 900, HELPDESK_WARN_INTERVAL_MS = 86400000
const HOUR = 3600000
export const helpDeskNudgeDelay = (hours: number) => hours * HOUR

// Fluxer removes U+000C and U+202E and trims a tag name before its own 1 to 50 code unit check
function bounded(value: unknown, maximum: number, label: string): string {
    if (typeof value !== "string" || value.length > maximum || !value.replace(/[\u000c‮]/g, "").trim()) fail(400, `${label} needs 1 to ${maximum} characters`)
    return value
}
export const helpDeskGreeting = (value: unknown) => value === null ? null : bounded(value, 500, "The greeting")
export const helpDeskTag = (value: unknown) => bounded(value, 50, "The tag name").trim()
export function helpDeskNudgeHours(value: unknown): number | null {
    if (value === null) return null
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 168) fail(400, "Reminders wait 1 to 168 hours")
    return value
}
export function helpDeskAnswerName(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value) || ["list", "set", "remove", "help"].includes(value)) fail(400, "Answer names have 1 to 32 lowercase letters, digits, - or _, and cannot be list, set, remove or help")
    return value
}

export function helpDeskOperation(value: unknown): HelpDeskOperation {
    const raw = shape(value, ["type", "channelId", "greeting", "solvedTag", "nudgeHours", "guardChannelId", "autoArchive", "name", "title", "content"], ["type"])
    if (raw.type === "forum-add" || raw.type === "forum-remove") { shape(raw, ["type", "channelId"], ["type", "channelId"]); return { type: raw.type, channelId: requireId(raw.channelId) } }
    if (raw.type === "answer-remove") { shape(raw, ["type", "name"], ["type", "name"]); return { type: "answer-remove", name: helpDeskAnswerName(raw.name) } }
    if (raw.type === "answer-set") {
        shape(raw, ["type", "name", "title", "content"], ["type", "name", "title", "content"])
        return { type: "answer-set", name: helpDeskAnswerName(raw.name), title: bounded(raw.title, 100, "An answer title").trim(), content: bounded(raw.content, 2000, "An answer") }
    }
    if (raw.type !== "settings") fail(400, "Unknown help desk operation")
    shape(raw, ["type", "greeting", "solvedTag", "nudgeHours", "guardChannelId", "autoArchive"], ["type"])
    if (Object.keys(raw).length === 1) fail(400, "Choose a help desk setting")
    if (raw.autoArchive !== undefined && typeof raw.autoArchive !== "boolean") fail(400, "Auto-archive is on or off")
    return {
        type: "settings",
        ...(raw.greeting === undefined ? {} : { greeting: helpDeskGreeting(raw.greeting) }),
        ...(raw.solvedTag === undefined ? {} : { solvedTag: helpDeskTag(raw.solvedTag) }),
        ...(raw.nudgeHours === undefined ? {} : { nudgeHours: helpDeskNudgeHours(raw.nudgeHours) }),
        ...(raw.guardChannelId === undefined ? {} : { guardChannelId: raw.guardChannelId === null ? null : requireId(raw.guardChannelId) }),
        ...(raw.autoArchive === undefined ? {} : { autoArchive: raw.autoArchive }),
    }
}
