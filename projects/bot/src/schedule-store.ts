import { SchedulesDeliveryResult, SchedulesManageResult, SchedulesQueryResult, type SchedulesDeliveryRequest, type SchedulesManageRequest, type SchedulesQueryRequest } from "@neonflux/contracts/schedules"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const same = (a: unknown, b: unknown): boolean => {
    const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, normalize(x)])) : v
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}
export class SchedulesStoreError extends Data.TaggedError("SchedulesStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface SchedulesStore {
    manage(input: SchedulesManageRequest): Effect.Effect<SchedulesManageResult, SchedulesStoreError>
    query(input: SchedulesQueryRequest): Effect.Effect<SchedulesQueryResult, SchedulesStoreError>
    delivery(input: SchedulesDeliveryRequest): Effect.Effect<SchedulesDeliveryResult, SchedulesStoreError>
}
export function createSchedulesStore(config: BackendConfig): SchedulesStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean) => request(`/schedules/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.filterOrFail(matches, () => new SchedulesStoreError({ operation, status: null })),
        Effect.mapError(error => new SchedulesStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, SchedulesManageResult, v => {
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
        query: input => call("query", input, SchedulesQueryResult, v => {
            const op = input.operation
            if (op.type === "settings" || op.type === "status") return v.type === op.type
            if (op.type === "show") return v.type === "schedule" && ("name" in op ? v.schedule.name === op.name : v.schedule.scheduleNo === op.scheduleNo)
            if (op.type === "list") return v.type === "schedules" && v.schedules.every((s, i) => (!op.beforeScheduleNo || s.scheduleNo < op.beforeScheduleNo) && (i === 0 || s.scheduleNo < v.schedules[i - 1]!.scheduleNo)) && (!v.nextBeforeScheduleNo || v.schedules.at(-1)?.scheduleNo === v.nextBeforeScheduleNo)
            return op.type === "deliveries" && v.type === "deliveries" && new Set(v.deliveries.map(d => d.deliveryId)).size === v.deliveries.length && v.deliveries.every((d, i) => d.scheduleNo === op.scheduleNo && (!op.afterOccurrenceNo || d.occurrenceNo > op.afterOccurrenceNo) && (i === 0 || d.occurrenceNo > v.deliveries[i - 1]!.occurrenceNo)) && (!v.nextAfterOccurrenceNo || v.deliveries.at(-1)?.occurrenceNo === v.nextAfterOccurrenceNo)
        }),
        delivery: input => call("delivery", input, SchedulesDeliveryResult, v => {
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
