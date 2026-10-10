import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { canonicalPublishingContent, equalPublishingContent, publishingContentSchema } from "./publishing-content.ts"
import { publishingGrantFields, publishingGrantSchema, publishingPostSchema } from "./publishing-store.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(n => Number.isSafeInteger(n) && n >= min && n <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.makeFilter(v => /^[a-zA-Z0-9_-]{1,128}$/.test(v)))
const name = Schema.String.check(Schema.makeFilter(v => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)))
const optional = Schema.optionalKey
const list = <A>(schema: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(max))
const localMinute = Schema.String.check(Schema.makeFilter(v => /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v) && Number.isFinite(Date.parse(`${v}Z`)) && new Date(`${v}Z`).toISOString().slice(0, 16) === v))
const zone = Schema.String.check(Schema.makeFilter(v => v.length <= 128 && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(v) && (() => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true } catch { return false } })()))
const source = Schema.Struct({ kind: Schema.Literals(["draft", "template"]), name, revision: integer(1) })
const snapshot = { source, content: publishingContentSchema, canonicalContent: publishingContentSchema }
const canonical = (v: C.SchedulesSnapshot) => equalPublishingContent(v.canonicalContent, canonicalPublishingContent(v.content))
const date = Schema.Struct({ localMinute, dueAt: integer(), offsetMinutes: integer(-1440, 1440) }).check(Schema.makeFilter(v => Date.parse(`${v.localMinute}Z`) === v.dueAt + v.offsetMinutes * 60000))
const recurrence = Schema.Union([Schema.Struct({ type: Schema.Literal("none") }), Schema.Struct({ type: Schema.Literals(["daily", "weekly"]), interval: integer(1, 12), count: integer(1, 26) })])
const calendar = Schema.Struct({ localMinute, zone, fold: Schema.Literals(["reject", "earlier", "later"]), recurrence, dates: list(date, 26) }).check(Schema.makeFilter(v => {
    const r = v.recurrence
    return v.dates.length === (r.type === "none" ? 1 : r.count) && v.dates.at(-1)!.dueAt - v.dates[0]!.dueAt <= 180 * 86400000
        && v.dates.every((d, i) => d.localMinute === new Date(Date.parse(`${v.localMinute}Z`) + i * (r.type === "none" ? 0 : r.interval * (r.type === "weekly" ? 7 : 1)) * 86400000).toISOString().slice(0, 16)
            && (i === 0 || d.dueAt > v.dates[i - 1]!.dueAt))
}))
const definition = Schema.Struct({ ...snapshot, scheduleNo: integer(1), name, revision: integer(1), planRevision: integer(1), createdBy: id, channelId: id,
    calendar, enabled: Schema.Boolean, cancelled: Schema.Boolean, activatedAt: integer(), createdAt: integer(), updatedAt: integer() }).check(Schema.makeFilter(v => canonical(v) && v.updatedAt >= v.createdAt && v.planRevision <= v.revision && (!v.cancelled || !v.enabled)))
const delivery = Schema.Struct({ ...snapshot, deliveryId: key, scheduleNo: integer(1), planRevision: integer(1), occurrenceNo: integer(1), channelId: id, localMinute, zone, offsetMinutes: integer(-1440, 1440), dueAt: integer(),
    state: Schema.Literals(["queued", "blocked", "reserved", "sent", "failed", "uncertain", "skipped", "cancelled", "superseded"]), nextCheckAt: integer(), claimedAt: optional(integer()), postNo: optional(integer(1)), attemptId: optional(key),
    reason: optional(Schema.Literals(["activation-cutoff", "late-window", "superseded", "cancelled", "permission", "capacity", "dispatch-expired"])) }).check(Schema.makeFilter(v => canonical(v)
        && Date.parse(`${v.localMinute}Z`) === v.dueAt + v.offsetMinutes * 60000 && (v.postNo === undefined) === (v.attemptId === undefined)
        && (v.claimedAt === undefined || v.postNo !== undefined) && (!["reserved", "sent", "uncertain"].includes(v.state) || v.postNo !== undefined)))
const settings = Schema.Struct({ enabled: Schema.Boolean, revision: integer(1), activatedAt: integer() })
const cursor = Schema.Struct({ cursor: Schema.String.check(Schema.makeFilter(v => v.length > 0 && v.length <= 4096)), throughAt: integer() })
const manage = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("schedule"), schedule: definition }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconciled"), recorded: Schema.Boolean, post: publishingPostSchema }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), scheduleNo: integer(1), complete: Schema.Boolean, removed: integer() })])
const query = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings }), Schema.Struct({ type: Schema.Literal("status"), settings, definitions: integer(0, 50), deliveries: integer(0, 200), receipts: integer(0, 1000),
    publishing: Schema.Struct({ enabled: Schema.Boolean }), limits: Schema.Struct({ definitions: Schema.Literal(50), deliveries: Schema.Literal(200), receipts: Schema.Literal(1000) }) }),
    Schema.Struct({ type: Schema.Literal("schedules"), schedules: list(definition, 20), nextBeforeScheduleNo: optional(integer(1)) }), Schema.Struct({ type: Schema.Literal("schedule"), schedule: definition }),
    Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: list(delivery, 20), nextAfterOccurrenceNo: optional(integer(1)) })])
const scheduleGrant = Schema.Struct({ ...publishingGrantFields, source: Schema.Struct({ type: Schema.Literal("schedule-timer"), deliveryId: key, dueAt: integer() }),
    provenance: Schema.Struct({ type: Schema.Literal("schedule"), scheduleNo: integer(1), planRevision: integer(1), source }),
    consumer: Schema.Struct({ type: Schema.Literal("schedule"), scheduleNo: integer(1), planRevision: integer(1), occurrenceNo: integer(1), deliveryId: key }) })
    .check(Schema.makeFilter(v => { try { Schema.decodeUnknownSync(publishingGrantSchema, { onExcessProperty: "error" })(v); return true } catch { return false } }))
const deliveries = Schema.Union([Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: list(delivery, 20), hasMore: Schema.Boolean, nextCursor: optional(cursor) }),
    Schema.Struct({ type: Schema.Literal("reservation"), status: Schema.Literal("reserved"), grant: scheduleGrant }), Schema.Struct({ type: Schema.Literal("reservation"), status: Schema.Literals(["waiting", "skipped", "cancelled", "terminal"]) }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean })])
const same = (a: unknown, b: unknown): boolean => {
    const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, normalize(x)])) : v
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}
export class SchedulesStoreError extends Data.TaggedError("SchedulesStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface SchedulesStore {
    manage(input: C.SchedulesManageRequest): Effect.Effect<C.SchedulesManageResult, SchedulesStoreError>
    query(input: C.SchedulesQueryRequest): Effect.Effect<C.SchedulesQueryResult, SchedulesStoreError>
    delivery(input: C.SchedulesDeliveryRequest): Effect.Effect<C.SchedulesDeliveryResult, SchedulesStoreError>
}
export function createSchedulesStore(config: BackendConfig): SchedulesStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean) => request(`/schedules/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.filterOrFail(matches, () => new SchedulesStoreError({ operation, status: null })),
        Effect.mapError(error => new SchedulesStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, manage, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "settings") return v.type === "settings" && v.settings.enabled === op.enabled && v.settings.revision === op.expectedRevision + 1
            if (op.type === "forget") return v.type === "forgotten" && v.scheduleNo === op.scheduleNo
            if (op.type === "reconcile") return v.type === "reconciled" && v.post.consumer?.type === "schedule" && v.post.consumer.scheduleNo === op.scheduleNo && v.post.consumer.deliveryId === op.deliveryId
                && v.post.generation === op.expectedGeneration && v.post.attempt.attemptId === op.attemptId && v.post.messageId === op.observation.messageId && v.post.channelId === op.observation.channelId && v.post.botId === op.observation.botId
            if (v.type !== "schedule") return false
            const s = v.schedule
            if (op.type === "create") return s.name === op.name && s.channelId === op.channelId && s.createdBy === input.context.actor.userId && s.revision === 1 && s.planRevision === 1 && !s.enabled && !s.cancelled && same(s.source, op.source) && same(s.calendar, op.calendar)
            if (s.scheduleNo !== op.scheduleNo || s.revision !== op.expectedRevision + 1) return false
            if (op.type === "content") return same(s.source, op.source)
            if (op.type === "calendar") return same(s.calendar, op.calendar)
            if (op.type === "destination") return s.channelId === op.channelId
            return op.type === "enable" ? s.enabled && !s.cancelled : op.type === "cancel" ? s.cancelled && !s.enabled : !s.enabled
        }),
        query: input => call("query", input, query, v => {
            const op = input.operation
            if (op.type === "settings" || op.type === "status") return v.type === op.type
            if (op.type === "show") return v.type === "schedule" && ("name" in op ? v.schedule.name === op.name : v.schedule.scheduleNo === op.scheduleNo)
            if (op.type === "list") return v.type === "schedules" && v.schedules.every((s, i) => (!op.beforeScheduleNo || s.scheduleNo < op.beforeScheduleNo) && (i === 0 || s.scheduleNo < v.schedules[i - 1]!.scheduleNo)) && (!v.nextBeforeScheduleNo || v.schedules.at(-1)?.scheduleNo === v.nextBeforeScheduleNo)
            return op.type === "deliveries" && v.type === "deliveries" && new Set(v.deliveries.map(d => d.deliveryId)).size === v.deliveries.length && v.deliveries.every((d, i) => d.scheduleNo === op.scheduleNo && (!op.afterOccurrenceNo || d.occurrenceNo > op.afterOccurrenceNo) && (i === 0 || d.occurrenceNo > v.deliveries[i - 1]!.occurrenceNo)) && (!v.nextAfterOccurrenceNo || v.deliveries.at(-1)?.occurrenceNo === v.nextAfterOccurrenceNo)
        }),
        delivery: input => call("delivery", input, deliveries, v => {
            const op = input.operation
            if (op.type === "list") return v.type === "deliveries" && new Set(v.deliveries.map(d => d.deliveryId)).size === v.deliveries.length
                && v.hasMore === (v.nextCursor !== undefined) && (!v.nextCursor || !op.cursor || v.nextCursor.throughAt === op.cursor.throughAt && v.nextCursor.cursor !== op.cursor.cursor)
            if (op.type === "defer") return v.type === "progress"
            if (v.type !== "reservation") return false
            if (v.status !== "reserved") return true
            const g = v.grant, b = op.binding
            return g.source?.type === "schedule-timer" && g.consumer?.type === "schedule" && g.provenance?.type === "schedule"
                && g.source.deliveryId === b.deliveryId && g.consumer.deliveryId === b.deliveryId && g.consumer.scheduleNo === b.scheduleNo && g.consumer.planRevision === b.planRevision && g.consumer.occurrenceNo === b.occurrenceNo
                && g.actorId === op.context.botId && g.channelId === op.context.channelId && g.botId === op.context.botId
        }),
    }
}
export function schedulesErrorMessage(error: SchedulesStoreError) {
    if (error.status === 403) return "You can't do that with schedules right now. Your permissions, verification or the DEFCON level don't allow it"
    if (error.status === 404) return "That schedule or post was not found"
    if (error.status === 409) return "The schedule changed while this command ran. Send the command again. A taken name, a cancelled schedule or a post that is still being sent or not confirmed yet also blocks changes"
    if (error.status === 400) return "That schedule change is not valid. Check the dates and the confirm step in !publish schedule help"
    if (error.status === 429) return "This server has reached its limit of schedules or posts. Forget old schedules to make room"
    return "The schedule change could not be confirmed. Check the schedule before you repeat it"
}
