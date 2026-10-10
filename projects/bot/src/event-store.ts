import { EventsManageResult, EventsQueryResult, EventsRsvpResult, EventsWorkResult, EventsDeliveryResult, type EventsManageRequest, type EventsQueryRequest, type EventsRsvpRequest, type EventsWorkRequest, type EventsDeliveryRequest } from "@neonflux/contracts/events"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

function equalData(a: unknown, b: unknown): boolean {
    const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).sort(([x],[y]) => x.localeCompare(y)).map(([k,x]) => [k, normalize(x)])) : v
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

export class EventsStoreError extends Data.TaggedError("EventsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface EventsStore {
    manage(input: EventsManageRequest): Effect.Effect<EventsManageResult, EventsStoreError>
    query(input: EventsQueryRequest): Effect.Effect<EventsQueryResult, EventsStoreError>
    rsvp(input: EventsRsvpRequest): Effect.Effect<EventsRsvpResult, EventsStoreError>
    work(input: EventsWorkRequest): Effect.Effect<EventsWorkResult, EventsStoreError>
    delivery(input: EventsDeliveryRequest): Effect.Effect<EventsDeliveryResult, EventsStoreError>
}
export function createEventsStore(config: BackendConfig): EventsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean) => request(`/events/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.filterOrFail(matches, () => new EventsStoreError({ operation, status: null })),
        Effect.mapError(error => new EventsStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, EventsManageResult, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "settings" || op.type === "threads") return v.type === "settings" && v.settings[op.type === "settings" ? "enabled" : "threads"] === op.enabled && v.settings.revision === op.expectedRevision + 1
            if (op.type === "forget") return v.type === "forgotten" && v.eventNo === op.eventNo
            if (v.type !== "event") return false
            if (op.type === "create") return v.event.name === op.name && v.event.channelId === op.channelId && v.event.title === op.title && v.event.description === (op.description ?? "")
                && v.event.revision === 1 && v.event.state === "draft" && !v.grant
            if (v.event.eventNo !== op.eventNo || v.event.revision < op.expectedRevision) return false
            if (!["publish", "reconcile"].includes(op.type) && v.event.revision !== op.expectedRevision + 1) return false
            if (op.type === "calendar" && !equalData(v.event.calendar, op.calendar)) return false
            if (op.type === "capacity" && v.event.capacity !== op.capacity || op.type === "cancel" && v.event.state !== "cancelled") return false
            if (op.type === "content" && (v.event.title !== op.title || v.event.description !== op.description)) return false
            if (op.type === "template" && (op.templateName === null ? v.event.template !== undefined : v.event.template?.name !== op.templateName || v.event.template.revision !== op.expectedTemplateRevision)) return false
            if (op.type === "reminders" && [...v.event.reminderOffsets].sort((a,b) => a-b).join() !== [...op.offsets].sort((a,b) => a-b).join()) return false
            return !v.grant || v.grant.consumer.eventNo === v.event.eventNo && v.grant.consumer.revision === v.event.revision && v.grant.consumer.purpose === "card"
                && v.grant.source.type === "human" && v.grant.source.messageId === input.messageId && v.grant.source.createdAt === input.createdAt && v.grant.actorId === input.context.actor.userId
                && v.grant.channelId === (v.event.postId ?? v.event.channelId) && v.grant.botId === input.context.botId && v.grant.postNo === v.event.cardPostNo
        }),
        query: input => call("query", input, EventsQueryResult, v => {
            const op = input.operation
            if (op.type === "settings" || op.type === "status") return v.type === op.type
            if (op.type === "show") return v.type === "event" && ("name" in op ? v.event.name === op.name : v.event.eventNo === op.eventNo)
            if (op.type === "list") return v.type === "events" && v.events.every((e, i) => e.channelId === input.context.channelId && (!op.beforeEventNo || e.eventNo < op.beforeEventNo) && (i === 0 || e.eventNo < v.events[i-1]!.eventNo))
                && (!v.nextBeforeEventNo || v.events.at(-1)?.eventNo === v.nextBeforeEventNo)
            if (op.type === "dates") return v.type === "dates" && v.dates.every((d, i) => d.eventNo === op.eventNo && (!op.afterOccurrenceNo || d.occurrenceNo > op.afterOccurrenceNo) && (i === 0 || d.occurrenceNo > v.dates[i-1]!.occurrenceNo))
                && (!v.nextAfterOccurrenceNo || v.dates.at(-1)?.occurrenceNo === v.nextAfterOccurrenceNo)
            return op.type === "attendees" && v.type === "attendees" && v.attendees.every((a, i) => a.eventNo === op.eventNo && a.occurrenceNo === op.occurrenceNo && (!op.afterUserId || a.userId > op.afterUserId) && (i === 0 || a.userId > v.attendees[i-1]!.userId))
                && (!v.nextAfterUserId || v.attendees.at(-1)?.userId === v.nextAfterUserId)
        }),
        rsvp: input => call("rsvp", input, EventsRsvpResult, v => v.occurrence.eventNo === input.eventNo && v.occurrence.occurrenceNo === input.occurrenceNo
            && (!v.rsvp || v.rsvp.eventNo === input.eventNo && v.rsvp.occurrenceNo === input.occurrenceNo && v.rsvp.userId === input.context.actor.userId)
            && (!v.accepted || !!v.rsvp && v.rsvp.choice === input.choice && v.rsvp.joinedAt === input.context.member?.joinedAt && v.rsvp.acceptedMessageId === input.messageId && v.rsvp.acceptedCreatedAt === input.createdAt)),
        work: input => call("work", input, EventsWorkResult, v => {
            const op = input.operation
            if ((v.type === "jobs" || v.type === "member-targets") && v.nextCursor
                && (v.nextCursor.serverId !== undefined && v.nextCursor.serverId !== input.serverId
                    || config.scopeMode === "multi" && v.nextCursor.serverId !== input.serverId)) return false
            if (op.type === "list") return v.type === "jobs" && v.jobs.length <= (op.limit ?? 20) && v.jobs.every((j, i) =>
                (!op.cursor || j.eventNo > op.cursor.eventNo || j.eventNo === op.cursor.eventNo && j.occurrenceNo > op.cursor.occurrenceNo)
                && (i === 0 || j.eventNo > v.jobs[i-1]!.eventNo || j.eventNo === v.jobs[i-1]!.eventNo && j.occurrenceNo > v.jobs[i-1]!.occurrenceNo))
                && (!v.nextCursor || (!op.cursor || v.nextCursor.eventNo > op.cursor.eventNo || v.nextCursor.eventNo === op.cursor.eventNo && v.nextCursor.occurrenceNo > op.cursor.occurrenceNo)
                    && v.jobs.every(j => j.eventNo < v.nextCursor!.eventNo || j.eventNo === v.nextCursor!.eventNo && j.occurrenceNo <= v.nextCursor!.occurrenceNo))
            if (op.type === "member-targets") return v.type === "member-targets" && v.targets.every((t, i) => t.userId === op.userId
                && (!op.cursor || t.eventNo > op.cursor.eventNo || t.eventNo === op.cursor.eventNo && t.occurrenceNo > op.cursor.occurrenceNo)
                && (i === 0 || t.eventNo > v.targets[i-1]!.eventNo || t.eventNo === v.targets[i-1]!.eventNo && t.occurrenceNo > v.targets[i-1]!.occurrenceNo))
                && (!v.nextCursor || (!op.cursor || v.nextCursor.eventNo > op.cursor.eventNo || v.nextCursor.eventNo === op.cursor.eventNo && v.nextCursor.occurrenceNo > op.cursor.occurrenceNo)
                    && v.targets.every(t => t.eventNo < v.nextCursor!.eventNo || t.eventNo === v.nextCursor!.eventNo && t.occurrenceNo <= v.nextCursor!.occurrenceNo))
            if (op.type !== "claim") return v.type === "progress"
            return v.type === "head" && (!v.claimed || v.binding.eventNo === op.eventNo && v.binding.occurrenceNo === op.occurrenceNo && v.binding.revision === op.revision && v.binding.generation === op.generation && v.binding.claimToken === op.claimToken)
        }),
        delivery: input => call("delivery", input, EventsDeliveryResult, v => {
            const op = input.operation
            if (op.type === "defer" || op.type === "thread") return v.type === "progress"
            if (op.type === "show") return v.type === "event" && v.event.eventNo === op.eventNo
            if (op.type === "list" || op.type === "status") return v.type === "deliveries" && new Set(v.deliveries.map(d => d.deliveryId)).size === v.deliveries.length
                && v.deliveries.every(d => op.type === "status" ? d.eventNo === op.eventNo && (!op.afterDeliveryId || d.deliveryId > op.afterDeliveryId) : op.beforeDueAt === undefined || d.dueAt <= op.beforeDueAt)
                && (!v.nextAfterDeliveryId || v.deliveries.at(-1)?.deliveryId === v.nextAfterDeliveryId)
            if (v.type !== "reservation") return false
            if (v.status !== "reserved") return true
            const g = v.grant, b = op.binding
            return g.source.type === "event-timer" && g.source.deliveryId === b.deliveryId && g.consumer.purpose === "reminder" && g.consumer.deliveryId === b.deliveryId
                && g.consumer.eventNo === b.eventNo && g.consumer.occurrenceNo === b.occurrenceNo && g.consumer.revision === b.revision && g.consumer.offsetMinutes === b.offsetMinutes
                && g.actorId === op.context.botId && g.channelId === op.context.channelId && g.botId === op.context.botId
        }),
    }
}
export function eventsErrorMessage(error: EventsStoreError) {
    if (error.status === 403) return "You can't do that with events right now. Your permissions, verification or the DEFCON level don't allow it"
    if (error.status === 404) return "That event or date was not found in this channel"
    if (error.status === 409) return "The event changed or does not allow this right now. Check it with !event show <name> and send the command again if it still applies. A post that is not confirmed yet is never sent twice"
    if (error.status === 400) return "That event change is not valid. Check !event help for names, dates, capacity and the confirm step"
    if (error.status === 429) return "This server has reached its limit of events or posts. Forget old events before adding more"
    return "The event change could not be confirmed. Check the event before you repeat it"
}
