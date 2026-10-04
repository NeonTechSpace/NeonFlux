import { SchedulesDeliveryResult, SchedulesManageResult, SchedulesQueryResult, type SchedulesDeliveryRequest, type SchedulesManageRequest, type SchedulesQueryRequest } from "@neonflux/contracts/schedules"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

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
        // The store decodes and checks that an answer is about the target it asked for. Revisions and saved values are the backend's own postconditions
        manage: input => call("manage", input, SchedulesManageResult, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "settings") return v.type === "settings"
            if (op.type === "forget") return v.type === "forgotten" && v.scheduleNo === op.scheduleNo
            if (op.type === "reconcile") return v.type === "reconciled" && v.post.consumer?.type === "schedule" && v.post.consumer.scheduleNo === op.scheduleNo && v.post.consumer.deliveryId === op.deliveryId
                && v.post.attempt.attemptId === op.attemptId
            return v.type === "schedule" && (op.type === "create" ? v.schedule.name === op.name : v.schedule.scheduleNo === op.scheduleNo)
        }),
        query: input => call("query", input, SchedulesQueryResult, v => {
            const op = input.operation
            if (op.type === "settings" || op.type === "status") return v.type === op.type
            if (op.type === "show") return v.type === "schedule" && v.schedule.scheduleNo === op.scheduleNo
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
    if (error.status === 403) return "Current schedule permissions, membership or DEFCON policy rejected this operation"
    if (error.status === 404) return "That schedule or retained delivery was not found"
    if (error.status === 409) return "Schedule state changed. Read show and status with current revisions. Pending or uncertain ownership cannot replay or be forgotten"
    if (error.status === 400) return "Check exact source revisions, civil dates and confirmation syntax in !publish schedule help"
    if (error.status === 429) return "Schedule or publishing capacity is full. Inspect status and selectively forget settled history"
    return "Schedule persistence could not be confirmed. Read current status before repeating a change"
}
