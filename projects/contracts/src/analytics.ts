import { Schema } from "effect"
import { Id, Int, List, Millis, Token, origin } from "./common.ts"

// Server analytics, see docs/BOT.md#server-analytics. Counts only, no row names a member

export const HOUR_MS = 3600000, DAY_MS = 86400000
/** One batch holds at most 500 buckets, and one bucket counts at most a million */
export const MAX_BUCKETS = 500, MAX_COUNT = 1000000
const count = Int(0, MAX_COUNT)

/** One UTC hour of ordinary member messages in one channel. Hour is the hour's start in Unix milliseconds */
export const AnalyticsHourBucket = Schema.Struct({ channelId: Id, hour: Millis.check(Schema.makeFilter((value: number) => value % HOUR_MS === 0)), count: Int(1, MAX_COUNT) })
export type AnalyticsHourBucket = typeof AnalyticsHourBucket.Type
/** One UTC day of member joins and leaves. Day is the day's start in Unix milliseconds */
export const AnalyticsDayBucket = Schema.Struct({ day: Millis.check(Schema.makeFilter((value: number) => value % DAY_MS === 0)), joins: count, leaves: count })
    .check(Schema.makeFilter(value => value.joins + value.leaves > 0))
export type AnalyticsDayBucket = typeof AnalyticsDayBucket.Type
/** At most 500 buckets in total. Counts for the same bucket add to the stored rows.
 *  Session names one bot worker run and sequence numbers its batches from 1 upward. The backend applies each session's batches once,
 *  so a batch resent after a lost reply is acknowledged without counting it again. Resend a batch unchanged, and never send a lower sequence after a higher one */
export const AnalyticsRecordRequest = Schema.Struct({ serverId: Id, session: Token, sequence: Int(1), hours: List(AnalyticsHourBucket, MAX_BUCKETS), days: List(AnalyticsDayBucket, MAX_BUCKETS) })
    .check(Schema.makeFilter(value => value.hours.length + value.days.length >= 1 && value.hours.length + value.days.length <= MAX_BUCKETS))
export type AnalyticsRecordRequest = typeof AnalyticsRecordRequest.Type
/** Recorded is false when analytics is off for the server. Nothing is stored then. A batch the session already applied returns recorded true */
export const AnalyticsRecordResult = Schema.Struct({ enabled: Schema.Boolean, recorded: Schema.Boolean })
export type AnalyticsRecordResult = typeof AnalyticsRecordResult.Type
export const AnalyticsSettingsRequest = Schema.Struct({ serverId: Id })
export type AnalyticsSettingsRequest = typeof AnalyticsSettingsRequest.Type
export const AnalyticsSettings = Schema.Struct({ enabled: Schema.Boolean })
export type AnalyticsSettings = typeof AnalyticsSettings.Type
export const AnalyticsManageRequest = Schema.Struct({ ...origin, serverId: Id, actorId: Id, managerAuthorized: Schema.Literal(true), enabled: Schema.Boolean })
export type AnalyticsManageRequest = typeof AnalyticsManageRequest.Type
export const AnalyticsSummaryRequest = Schema.Struct({ serverId: Id })
export type AnalyticsSummaryRequest = typeof AnalyticsSummaryRequest.Type
/** Totals for the last seven UTC days including today. Busiest hours are at most three UTC hours of the day, 0 to 23, busiest first, ties by hour. onboarded counts members who finished the newcomer checklist */
export const AnalyticsSummary = Schema.Struct({ enabled: Schema.Boolean, since: Millis, joins: Int(), leaves: Int(), onboarded: Int(), messages: Int(),
    topChannels: List(Schema.Struct({ channelId: Id, count: Int() }), 3), busiestHours: List(Schema.Struct({ hour: Int(0, 23), count: Int() }), 3) })
export type AnalyticsSummary = typeof AnalyticsSummary.Type
