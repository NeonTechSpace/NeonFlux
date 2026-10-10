import { DAY_MS, HOUR_MS, MAX_COUNT, type AnalyticsDayBucket, type AnalyticsHourBucket, type AnalyticsRecordRequest } from "@neonflux/contracts/analytics"
import { fail } from "./validation.ts"

export { DAY_MS, HOUR_MS } from "@neonflux/contracts/analytics"
/** Channel and server message rows age out after 35 days, server join and leave rows after 400 days */
export const CHANNEL_RETENTION_MS = 35 * DAY_MS
export const DAY_RETENTION_MS = 400 * DAY_MS
/** A session's applied sequence is kept two days after its last batch. The bot gives up resending a batch after one day */
export const FLUSH_RETENTION_MS = 2 * DAY_MS
/** A server day lists at most this many channels. Messages in further channels still count in the day's total and hours */
export const MAX_DAY_CHANNELS = 1000

export const dayStart = (at: number) => Math.floor(at / DAY_MS) * DAY_MS
export const emptyHours = () => Array.from({ length: 24 }, () => 0)
/** A stored hours array as 24 counts. Rows written before hourly counts have none */
export const storedHours = (hours: readonly number[] | undefined) => hours?.length === 24 ? [...hours] : emptyHours()
export function addHours(stored: readonly number[] | undefined, add: readonly number[]) {
    const hours = storedHours(stored)
    add.forEach((count, hour) => { hours[hour] = hours[hour]! + count })
    return hours
}

// Buckets lie within their retention and at most an hour ahead. Buckets for the same key merge, so a request never writes one row twice
export function analyticsRecord(input: AnalyticsRecordRequest, now: number) {
    const hours = new Map<string, AnalyticsHourBucket>(), days = new Map<number, AnalyticsDayBucket>()
    for (const { channelId, hour, count } of input.hours) {
        if (hour < now - CHANNEL_RETENTION_MS || hour > now + HOUR_MS) fail(400, "Invalid analytics hour")
        const key = `${channelId}:${hour}`, previous = hours.get(key)
        hours.set(key, { channelId, hour, count: Math.min(MAX_COUNT, (previous?.count ?? 0) + count) })
    }
    for (const { day, joins, leaves } of input.days) {
        if (day < now - DAY_RETENTION_MS || day > now + HOUR_MS) fail(400, "Invalid analytics day")
        const previous = days.get(day)
        days.set(day, { day, joins: Math.min(MAX_COUNT, (previous?.joins ?? 0) + joins), leaves: Math.min(MAX_COUNT, (previous?.leaves ?? 0) + leaves) })
    }
    return { session: input.session, sequence: input.sequence, hours: [...hours.values()], days: [...days.values()] }
}

/** Group hourly buckets into channel days and server days, so a flush writes each stored row once */
export function groupHours(buckets: readonly AnalyticsHourBucket[]) {
    const channels = new Map<string, { channelId: string, day: number, count: number, hours: number[] }>()
    const days = new Map<number, { day: number, count: number, hours: number[], channels: Map<string, number> }>()
    for (const { channelId, hour, count } of buckets) {
        const day = dayStart(hour), index = (hour - day) / HOUR_MS, key = `${channelId}:${day}`
        const channel = channels.get(key) ?? { channelId, day, count: 0, hours: emptyHours() }
        channel.count += count; channel.hours[index] = channel.hours[index]! + count
        channels.set(key, channel)
        const server = days.get(day) ?? { day, count: 0, hours: emptyHours(), channels: new Map() }
        server.count += count; server.hours[index] = server.hours[index]! + count
        server.channels.set(channelId, (server.channels.get(channelId) ?? 0) + count)
        days.set(day, server)
    }
    return { channels: [...channels.values()], days: [...days.values()] }
}

/** Add a flush's channel counts to a server day's channel list, which keeps at most MAX_DAY_CHANNELS channels */
export function mergeChannels(stored: ReadonlyArray<{ channelId: string, count: number }>, add: ReadonlyMap<string, number>) {
    const merged = new Map(stored.map(row => [row.channelId, row.count]))
    for (const [channelId, count] of add) {
        const previous = merged.get(channelId)
        if (previous !== undefined) merged.set(channelId, previous + count)
        else if (merged.size < MAX_DAY_CHANNELS) merged.set(channelId, count)
    }
    return [...merged].map(([channelId, count]) => ({ channelId, count }))
}

/** Sum message counts by channel and return the busiest first, ties by channel ID */
export function topChannels(rows: ReadonlyArray<{ channelId: string, count: number }>, limit: number) {
    const totals = new Map<string, number>()
    for (const row of rows) totals.set(row.channelId, (totals.get(row.channelId) ?? 0) + row.count)
    return [...totals].map(([channelId, count]) => ({ channelId, count }))
        .sort((a, b) => b.count - a.count || (BigInt(a.channelId) < BigInt(b.channelId) ? -1 : 1)).slice(0, limit)
}

/** Sum server days by UTC hour of the day and return the busiest hours with messages first, ties by hour */
export function busiestHours(rows: ReadonlyArray<{ hours: readonly number[] }>, limit: number) {
    const totals = emptyHours()
    for (const row of rows) row.hours.forEach((count, hour) => { totals[hour] = totals[hour]! + count })
    return totals.map((count, hour) => ({ hour, count })).filter(row => row.count > 0).sort((a, b) => b.count - a.count || a.hour - b.hour).slice(0, limit)
}
