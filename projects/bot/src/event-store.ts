import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { publishingContentSchema } from "./publishing-content.ts"
import { publishingGrantFields, publishingGrantSchema } from "./publishing-store.ts"

function equalData(a: unknown, b: unknown): boolean {
    const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).sort(([x],[y]) => x.localeCompare(y)).map(([k,x]) => [k, normalize(x)])) : v
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(n => Number.isSafeInteger(n) && n >= min && n <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.makeFilter(v => /^[a-zA-Z0-9_-]{1,128}$/.test(v)))
const name = Schema.String.check(Schema.makeFilter(v => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)))
const optional = Schema.optionalKey
const list = <A>(schema: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(max))
const epoch = Schema.String.check(Schema.makeFilter(v => v.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))))
const localMinute = Schema.String.check(Schema.makeFilter(v => /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v) && Number.isFinite(Date.parse(`${v}Z`)) && new Date(`${v}Z`).toISOString().slice(0, 16) === v))
const state = Schema.Literals(["draft", "open", "started", "completed", "cancelled"])
const capacity = Schema.NullOr(integer(1, 500))
const offsets = list(integer(1, 10080), 2).check(Schema.makeFilter(v => new Set(v).size === v.length))
const dateFields = { localMinute, startsAt: integer(), endsAt: integer(), offsetMinutes: integer(-1440, 1440) }
const validDate = (v: C.EventsResolvedDate) => v.endsAt > v.startsAt && v.endsAt - v.startsAt <= 10080 * 60000 && (v.endsAt - v.startsAt) % 60000 === 0
    && Date.parse(`${v.localMinute}Z`) === v.startsAt + v.offsetMinutes * 60000
const date = Schema.Struct(dateFields).check(Schema.makeFilter(validDate))
const recurrence = Schema.Union([Schema.Struct({ type: Schema.Literal("none") }), Schema.Struct({ type: Schema.Literals(["daily", "weekly"]), interval: integer(1, 12), count: integer(1, 26) })])
const calendar = Schema.Struct({ localMinute, zone: Schema.String.check(Schema.makeFilter(v => /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(v) && v.length <= 128)), fold: Schema.Literals(["reject", "earlier", "later"]), durationMinutes: integer(1, 10080), recurrence, dates: list(date, 26) })
    .check(Schema.makeFilter(v => {
        const repeat = v.recurrence, count = repeat.type === "none" ? 1 : repeat.count
        return v.dates.length === count && v.dates.at(-1)!.startsAt - v.dates[0]!.startsAt <= 180 * 86400000
            && v.dates.every((d, index) => d.endsAt - d.startsAt === v.durationMinutes * 60000
                && d.localMinute === new Date(Date.parse(`${v.localMinute}Z`) + index * (repeat.type === "none" ? 0 : repeat.interval * (repeat.type === "weekly" ? 7 : 1)) * 86400000).toISOString().slice(0, 16)
                && (index === 0 || d.startsAt > v.dates[index - 1]!.startsAt))
    }))
const definition = Schema.Struct({ eventNo: integer(1), name, revision: integer(1), channelId: id,
    title: Schema.String.check(Schema.makeFilter(v => v.trim().length > 0 && v.length <= 256)), description: Schema.String.check(Schema.isMaxLength(4096)),
    capacity, reminderOffsets: offsets, state, participationStarted: Schema.Boolean, calendar: optional(calendar),
    template: optional(Schema.Struct({ name, revision: integer(1), content: publishingContentSchema })), cardPostNo: optional(integer(1)), postId: optional(id), threadId: optional(id), createdAt: integer(), updatedAt: integer() })
    .check(Schema.makeFilter(v => v.updatedAt >= v.createdAt && (v.state !== "open" && v.state !== "started" || v.calendar !== undefined)))
const occurrence = Schema.Struct({ ...dateFields, eventNo: integer(1), occurrenceNo: integer(1), revision: integer(1), state,
    participationStarted: Schema.Boolean, going: integer(0, 1000), waitlisted: integer(0, 1000), capacity, workGeneration: integer() })
    .check(Schema.makeFilter(v => validDate(v) && v.going + v.waitlisted <= 1000 && (v.capacity === null || v.going <= v.capacity)))
const rsvp = Schema.Struct({ eventNo: integer(1), occurrenceNo: integer(1), userId: id, joinedAt: epoch, membershipGeneration: integer(1), revision: integer(1),
    choice: Schema.Literals(["going", "maybe", "not-going", "none"]), allocation: Schema.Literals(["seat", "waitlist", "none"]), queueOrder: optional(integer(1)), acceptedCreatedAt: integer(), acceptedMessageId: id })
    .check(Schema.makeFilter(v => (v.choice === "going" ? v.allocation !== "none" : v.allocation === "none") && (v.allocation === "waitlist" ? v.queueOrder !== undefined : v.queueOrder === undefined)))
const settings = Schema.Struct({ enabled: Schema.Boolean, revision: integer(1), threads: Schema.Boolean })
const eventProvenance = Schema.Struct({ type: Schema.Literal("event"), eventNo: integer(1), revision: integer(1), template: optional(Schema.Struct({ name, revision: integer(1) })) })
const eventConsumer = Schema.Struct({ type: Schema.Literal("event"), eventNo: integer(1), revision: integer(1), purpose: Schema.Literals(["card", "reminder"]), occurrenceNo: optional(integer(1)), offsetMinutes: optional(integer(1, 10080)), deliveryId: optional(key) })
const source = Schema.Union([Schema.Struct({ type: Schema.Literal("human"), messageId: id, createdAt: integer() }), Schema.Struct({ type: Schema.Literal("event-timer"), deliveryId: key, dueAt: integer() }),
    Schema.Struct({ type: Schema.Literal("dashboard-configuration"), jobId: key, family: Schema.Literal("events"), createdAt: integer() })])
const eventGrant = Schema.Struct({ ...publishingGrantFields, source, provenance: eventProvenance, consumer: eventConsumer })
    .check(Schema.makeFilter(v => { try { Schema.decodeUnknownSync(publishingGrantSchema, { onExcessProperty: "error" })(v); return true } catch { return false } }))
const manage = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("event"), event: definition, grant: optional(eventGrant) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), eventNo: integer(1), complete: Schema.Boolean, removed: integer() })])
const query = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings }),
    Schema.Struct({ type: Schema.Literal("status"), settings, definitions: integer(0, 50), occurrences: integer(0, 200), rsvps: integer(0, 50000), receipts: integer(0, 50000) }),
    Schema.Struct({ type: Schema.Literal("events"), events: list(definition, 20), nextBeforeEventNo: optional(integer(1)) }),
    Schema.Struct({ type: Schema.Literal("event"), event: definition }), Schema.Struct({ type: Schema.Literal("dates"), dates: list(occurrence, 20), nextAfterOccurrenceNo: optional(integer(1)) }),
    Schema.Struct({ type: Schema.Literal("attendees"), attendees: list(rsvp, 20), nextAfterUserId: optional(id) })])
const job = Schema.Struct({ eventNo: integer(1), occurrenceNo: integer(1), revision: integer(1), generation: integer(1), nextCheckAt: integer(), channelId: id })
const binding = Schema.Struct({ eventNo: integer(1), occurrenceNo: integer(1), revision: integer(1), generation: integer(1), claimToken: Schema.String.check(Schema.makeFilter(v => /^[a-f0-9]{32}$/.test(v))), rsvpRevision: integer(1), membershipGeneration: integer(1), userId: id, joinedAt: epoch, queueOrder: integer(1) })
const memberTarget = Schema.Struct({ eventNo: integer(1), occurrenceNo: integer(1), revision: integer(1), generation: integer(), userId: id, joinedAt: epoch, membershipGeneration: integer(1), rsvpRevision: integer(1) })
const memberCursor = Schema.Struct({ eventNo: integer(1), occurrenceNo: integer(1), serverId: optional(id) })
const work = Schema.Union([Schema.Struct({ type: Schema.Literal("jobs"), jobs: list(job, 20), nextCursor: optional(memberCursor) }), Schema.Struct({ type: Schema.Literal("head"), claimed: Schema.Literal(false) }),
    Schema.Struct({ type: Schema.Literal("member-targets"), targets: list(memberTarget, 20), nextCursor: optional(memberCursor) }),
    Schema.Struct({ type: Schema.Literal("head"), claimed: Schema.Literal(true), binding, leaseExpiresAt: integer(1) }), Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean, promoted: optional(Schema.Boolean) })])
const delivery = Schema.Struct({ deliveryId: key, eventNo: integer(1), occurrenceNo: integer(1), revision: integer(1), offsetMinutes: integer(1, 10080), dueAt: integer(), startsAt: integer(),
    state: Schema.Literals(["queued", "blocked", "reserved", "sent", "failed", "uncertain", "skipped", "cancelled"]), nextCheckAt: integer(), channelId: id, postNo: optional(integer(1)), attemptId: optional(key) })
    .check(Schema.makeFilter(v => v.dueAt === v.startsAt - v.offsetMinutes * 60000 && (v.postNo === undefined) === (v.attemptId === undefined)))
const threadTitle = Schema.String.check(Schema.makeFilter(v => v.trim().length > 0 && v.length <= 256))
const threadWork = Schema.Union([Schema.Struct({ eventNo: integer(1), channelId: id, title: threadTitle, action: Schema.Literal("open"), messageId: id }),
    Schema.Struct({ eventNo: integer(1), channelId: id, title: threadTitle, action: Schema.Literal("close"), threadId: id })])
const deliveries = Schema.Union([Schema.Struct({ type: Schema.Literal("event"), event: definition }), Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: list(delivery, 20), nextAfterDeliveryId: optional(key), threads: optional(list(threadWork, 10)) }),
    Schema.Struct({ type: Schema.Literal("reservation"), status: Schema.Literal("reserved"), grant: eventGrant }), Schema.Struct({ type: Schema.Literal("reservation"), status: Schema.Literals(["waiting", "skipped", "cancelled", "terminal"]) }), Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean })])

export class EventsStoreError extends Data.TaggedError("EventsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface EventsStore {
    manage(input: C.EventsManageRequest): Effect.Effect<C.EventsManageResult, EventsStoreError>
    query(input: C.EventsQueryRequest): Effect.Effect<C.EventsQueryResult, EventsStoreError>
    rsvp(input: C.EventsRsvpRequest): Effect.Effect<C.EventsRsvpResult, EventsStoreError>
    work(input: C.EventsWorkRequest): Effect.Effect<C.EventsWorkResult, EventsStoreError>
    delivery(input: C.EventsDeliveryRequest): Effect.Effect<C.EventsDeliveryResult, EventsStoreError>
}
export function createEventsStore(config: BackendConfig): EventsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean) => request(`/events/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.filterOrFail(matches, () => new EventsStoreError({ operation, status: null })),
        Effect.mapError(error => new EventsStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, manage, v => {
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
        query: input => call("query", input, query, v => {
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
        rsvp: input => call("rsvp", input, Schema.Struct({ duplicate: Schema.Boolean, accepted: Schema.Boolean, rsvp: Schema.NullOr(rsvp), occurrence }), v => v.occurrence.eventNo === input.eventNo && v.occurrence.occurrenceNo === input.occurrenceNo
            && (!v.rsvp || v.rsvp.eventNo === input.eventNo && v.rsvp.occurrenceNo === input.occurrenceNo && v.rsvp.userId === input.context.actor.userId)
            && (!v.accepted || !!v.rsvp && v.rsvp.choice === input.choice && v.rsvp.joinedAt === input.context.member?.joinedAt && v.rsvp.acceptedMessageId === input.messageId && v.rsvp.acceptedCreatedAt === input.createdAt)),
        work: input => call("work", input, work, v => {
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
        delivery: input => call("delivery", input, deliveries, v => {
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
