import { HelpDeskOperation } from "@neonflux/contracts/helpdesk"
import { decode } from "./validation.ts"

export { HELPDESK_ANSWER_LIMIT, HELPDESK_FORUM_LIMIT, HELPDESK_NUDGES_PER_PASS } from "@neonflux/contracts/helpdesk"
export const HELPDESK_DEFAULT_GREETING = "Thanks for posting. Members and staff reply in this post. Send !solved once your question is answered"
export const HELPDESK_DEFAULT_TAG = "Solved", HELPDESK_DEFAULT_NUDGE_HOURS = 24
// Thread budget passes run hourly while the guard is on, and ten minutes apart while auto-archive changes remain. Fluxer allows
// 1,000 active threads per server, and staff are warned at 900, at most once a day
export const HELPDESK_GUARD_INTERVAL_MS = 3600000, HELPDESK_GUARD_SOON_MS = 600000, HELPDESK_GUARD_THRESHOLD = 900, HELPDESK_WARN_INTERVAL_MS = 86400000
const HOUR = 3600000
export const helpDeskNudgeDelay = (hours: number) => hours * HOUR

// Chat and dashboard changes carry the same operation. Tag names and answer titles are used trimmed
export function helpDeskOperation(value: unknown): HelpDeskOperation {
    const op = decode(HelpDeskOperation, value)
    if (op.type === "answer-set") return { ...op, title: op.title.trim() }
    return op.type === "settings" && op.solvedTag !== undefined ? { ...op, solvedTag: op.solvedTag.trim() } : op
}
