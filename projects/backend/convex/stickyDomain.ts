import type { StickyOperation } from "../contracts.js"
import { shape } from "./publishingDomain.ts"
import { fail, requireId } from "./validation.ts"

// A server keeps at most five sticky channels. A busy channel gets at most one repost per interval, 30 seconds unless set
export const STICKY_LIMIT = 5, STICKY_DEFAULT_INTERVAL = 30, STICKY_MIN_INTERVAL = 10, STICKY_MAX_INTERVAL = 3600

export function stickyContent(value: unknown): string {
    if (typeof value !== "string" || value.length > 2000 || !value.trim()) fail(400, "Sticky text needs 1 to 2000 characters")
    return value
}
export function stickyInterval(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < STICKY_MIN_INTERVAL || value > STICKY_MAX_INTERVAL) fail(400, `Sticky intervals are ${STICKY_MIN_INTERVAL} to ${STICKY_MAX_INTERVAL} seconds`)
    return value
}
export function stickyOperation(value: unknown): StickyOperation {
    const raw = shape(value, ["type", "channelId", "content", "intervalSeconds"], ["type", "channelId"]), channelId = requireId(raw.channelId)
    if (raw.type === "remove") { shape(raw, ["type", "channelId"]); return { type: "remove", channelId } }
    if (raw.type !== "set") fail(400, "Unknown sticky operation")
    if (raw.content === undefined && raw.intervalSeconds === undefined) fail(400, "Choose the sticky text or interval")
    return { type: "set", channelId, ...(raw.content === undefined ? {} : { content: stickyContent(raw.content) }), ...(raw.intervalSeconds === undefined ? {} : { intervalSeconds: stickyInterval(raw.intervalSeconds) }) }
}
