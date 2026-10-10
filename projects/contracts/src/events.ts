import { Schema } from "effect"
import { Id, Int, IsoTime, List, Millis, Text, Token, origin } from "./common.ts"
import { ModerationSource } from "./shared.ts"
import { CivilLocalMinute, CivilOffset, CivilZoneName, civilAt, civilIntent, civilSeries } from "./civil.ts"
import {
    PublishingContent,
    PublishingEventConsumer,
    PublishingGrant,
    PublishingName,
    PublishingProvenance,
    PublishingSource,
    publishingGrantFields,
} from "./publishing-base.ts"
import { SchedulesContext } from "./schedules.ts"

export const EVENTS_DAY = 86400000,
    EVENTS_BATCH = 20
const optional = Schema.optionalKey
const name = PublishingName
const requestName = Schema.String.check(
    Schema.makeFilter((value) => Schema.is(PublishingName)(value.trim().toLowerCase())),
)
/**
 * An event description has at most 1000 code units in chat, the dashboard and requests. Its staff detail reply adds at most about 900
 * code units of name, a 256-unit title, times, a 128-unit zone and labels, so in plain text the whole card stays within one 2000-unit
 * Fluxer message, of which the reply style fills 1900
 */
export const EVENTS_DESCRIPTION_LIMIT = 1000
const description = Schema.Union([Schema.Literal(""), Text(EVENTS_DESCRIPTION_LIMIT)])
export const EventsChoice = Schema.Literals(["going", "maybe", "not-going", "none"])
export type EventsChoice = typeof EventsChoice.Type
export const EventsLifecycle = Schema.Literals(["draft", "open", "started", "completed", "cancelled"])
export type EventsLifecycle = typeof EventsLifecycle.Type
export const EventsAllocation = Schema.Literals(["seat", "waitlist", "none"])
export const EventsDeliveryState = Schema.Literals([
    "queued",
    "blocked",
    "reserved",
    "sent",
    "failed",
    "uncertain",
    "skipped",
    "cancelled",
])
export const EventsCapacity = Schema.NullOr(Int(1, 500))
export type EventsCapacity = typeof EventsCapacity.Type
export const EventsReminderOffsets = List(Int(1, 10080), 2).check(
    Schema.makeFilter((v) => new Set(v).size === v.length),
)
export type EventsReminderOffsets = typeof EventsReminderOffsets.Type
const dateFields = { localMinute: CivilLocalMinute, startsAt: Int(), endsAt: Int(), offsetMinutes: CivilOffset }
const validDate = (v: EventsResolvedDate) =>
    v.endsAt > v.startsAt &&
    v.endsAt - v.startsAt <= 10080 * 60000 &&
    (v.endsAt - v.startsAt) % 60000 === 0 &&
    civilAt(v.localMinute, v.startsAt, v.offsetMinutes)
export const EventsResolvedDate = Schema.Struct(dateFields).check(Schema.makeFilter(validDate))
export type EventsResolvedDate = typeof EventsResolvedDate.Type
// Stored events keep their zone, so reading one back does not ask this runtime's zone database again
export const EventsCalendar = Schema.Struct({
    ...civilIntent,
    zone: CivilZoneName,
    durationMinutes: Int(1, 10080),
    dates: List(EventsResolvedDate, 26),
}).check(
    Schema.makeFilter(
        (v) =>
            civilSeries(
                v,
                v.dates.map((d) => d.startsAt),
            ) && v.dates.every((d) => d.endsAt - d.startsAt === v.durationMinutes * 60000),
    ),
)
export type EventsCalendar = typeof EventsCalendar.Type
/** postId is the forum post that holds the card in a forum or media channel, and threadId the discussion thread started on the card in another channel */
export const EventsDefinition = Schema.Struct({
    eventNo: Int(1),
    name,
    revision: Int(1),
    channelId: Id,
    title: Schema.String.check(Schema.makeFilter((v) => v.trim().length > 0 && v.length <= 256)),
    description,
    capacity: EventsCapacity,
    reminderOffsets: EventsReminderOffsets,
    state: EventsLifecycle,
    participationStarted: Schema.Boolean,
    calendar: optional(EventsCalendar),
    template: optional(Schema.Struct({ name, revision: Int(1), content: PublishingContent })),
    cardPostNo: optional(Int(1)),
    postId: optional(Id),
    threadId: optional(Id),
    createdAt: Int(),
    updatedAt: Int(),
}).check(
    Schema.makeFilter(
        (v) =>
            v.updatedAt >= v.createdAt && ((v.state !== "open" && v.state !== "started") || v.calendar !== undefined),
    ),
)
export type EventsDefinition = typeof EventsDefinition.Type
export const EventsOccurrence = Schema.Struct({
    ...dateFields,
    eventNo: Int(1),
    occurrenceNo: Int(1),
    revision: Int(1),
    state: EventsLifecycle,
    participationStarted: Schema.Boolean,
    going: Int(0, 1000),
    waitlisted: Int(0, 1000),
    capacity: EventsCapacity,
    workGeneration: Int(),
}).check(
    Schema.makeFilter(
        (v) => validDate(v) && v.going + v.waitlisted <= 1000 && (v.capacity === null || v.going <= v.capacity),
    ),
)
export type EventsOccurrence = typeof EventsOccurrence.Type
export const EventsRsvp = Schema.Struct({
    eventNo: Int(1),
    occurrenceNo: Int(1),
    userId: Id,
    joinedAt: IsoTime,
    membershipGeneration: Int(1),
    revision: Int(1),
    choice: EventsChoice,
    allocation: EventsAllocation,
    queueOrder: optional(Int(1)),
    acceptedCreatedAt: Int(),
    acceptedMessageId: Id,
}).check(
    Schema.makeFilter(
        (v) =>
            (v.choice === "going" ? v.allocation !== "none" : v.allocation === "none") &&
            (v.allocation === "waitlist" ? v.queueOrder !== undefined : v.queueOrder === undefined),
    ),
)
export type EventsRsvp = typeof EventsRsvp.Type
export const EventsSettings = Schema.Struct({ enabled: Schema.Boolean, revision: Int(1), threads: Schema.Boolean })
export type EventsSettings = typeof EventsSettings.Type
const eventProvenance = PublishingProvenance.members[6]
export const EventsDeliveryGrant = Schema.Struct({
    ...publishingGrantFields,
    source: PublishingSource,
    provenance: eventProvenance,
    consumer: PublishingEventConsumer,
}).check(Schema.makeFilter(Schema.is(PublishingGrant)))
export type EventsDeliveryGrant = typeof EventsDeliveryGrant.Type
export const EventsManageResult = Schema.Union([
    Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: EventsSettings }),
    Schema.Struct({
        duplicate: Schema.Literal(false),
        type: Schema.Literal("event"),
        event: EventsDefinition,
        grant: optional(EventsDeliveryGrant),
    }),
    Schema.Struct({
        duplicate: Schema.Literal(false),
        type: Schema.Literal("forgotten"),
        eventNo: Int(1),
        complete: Schema.Boolean,
        removed: Int(),
    }),
])
export type EventsManageResult = typeof EventsManageResult.Type
export const EventsQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: EventsSettings }),
    Schema.Struct({
        type: Schema.Literal("status"),
        settings: EventsSettings,
        definitions: Int(0, 50),
        occurrences: Int(0, 200),
        rsvps: Int(0, 50000),
        receipts: Int(0, 50000),
    }),
    Schema.Struct({
        type: Schema.Literal("events"),
        events: List(EventsDefinition, 20),
        nextBeforeEventNo: optional(Int(1)),
    }),
    Schema.Struct({ type: Schema.Literal("event"), event: EventsDefinition }),
    Schema.Struct({
        type: Schema.Literal("dates"),
        dates: List(EventsOccurrence, 20),
        nextAfterOccurrenceNo: optional(Int(1)),
    }),
    Schema.Struct({
        type: Schema.Literal("attendees"),
        attendees: List(EventsRsvp, 20),
        nextAfterUserId: optional(Id),
    }),
])
export type EventsQueryResult = typeof EventsQueryResult.Type
export const EventsPromotionJob = Schema.Struct({
    eventNo: Int(1),
    occurrenceNo: Int(1),
    revision: Int(1),
    generation: Int(1),
    nextCheckAt: Int(),
    channelId: Id,
})
export type EventsPromotionJob = typeof EventsPromotionJob.Type
export const EventsPromotionBinding = Schema.Struct({
    eventNo: Int(1),
    occurrenceNo: Int(1),
    revision: Int(1),
    generation: Int(1),
    claimToken: Schema.String.check(Schema.makeFilter((v) => /^[a-f0-9]{32}$/.test(v))),
    rsvpRevision: Int(1),
    membershipGeneration: Int(1),
    userId: Id,
    joinedAt: IsoTime,
    queueOrder: Int(1),
})
export type EventsPromotionBinding = typeof EventsPromotionBinding.Type
export const EventsMemberTarget = Schema.Struct({
    eventNo: Int(1),
    occurrenceNo: Int(1),
    revision: Int(1),
    generation: Int(),
    userId: Id,
    joinedAt: IsoTime,
    membershipGeneration: Int(1),
    rsvpRevision: Int(1),
})
export type EventsMemberTarget = typeof EventsMemberTarget.Type
export const EventsMemberCursor = Schema.Struct({ eventNo: Int(1), occurrenceNo: Int(1) })
export type EventsMemberCursor = typeof EventsMemberCursor.Type
export const EventsWorkResult = Schema.Union([
    Schema.Struct({
        type: Schema.Literal("jobs"),
        jobs: List(EventsPromotionJob, 20),
        nextCursor: optional(EventsMemberCursor),
    }),
    Schema.Struct({ type: Schema.Literal("head"), claimed: Schema.Literal(false) }),
    Schema.Struct({
        type: Schema.Literal("member-targets"),
        targets: List(EventsMemberTarget, 20),
        nextCursor: optional(EventsMemberCursor),
    }),
    Schema.Struct({
        type: Schema.Literal("head"),
        claimed: Schema.Literal(true),
        binding: EventsPromotionBinding,
        leaseExpiresAt: Int(1),
    }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean, promoted: optional(Schema.Boolean) }),
])
export type EventsWorkResult = typeof EventsWorkResult.Type
export const EventsDeliveryBinding = Schema.Struct({
    deliveryId: Token,
    eventNo: Int(1),
    occurrenceNo: Int(1),
    revision: Int(1),
    offsetMinutes: Int(1, 10080),
})
export type EventsDeliveryBinding = typeof EventsDeliveryBinding.Type
export const EventsDelivery = Schema.Struct({
    ...EventsDeliveryBinding.fields,
    dueAt: Int(),
    startsAt: Int(),
    state: EventsDeliveryState,
    nextCheckAt: Int(),
    channelId: Id,
    postNo: optional(Int(1)),
    attemptId: optional(Token),
}).check(
    Schema.makeFilter(
        (v) =>
            v.dueAt === v.startsAt - v.offsetMinutes * 60000 &&
            (v.postNo === undefined) === (v.attemptId === undefined),
    ),
)
export type EventsDelivery = typeof EventsDelivery.Type
const threadTitle = Schema.String.check(Schema.makeFilter((v) => v.trim().length > 0 && v.length <= 256))
/** Discussion thread work: Start a thread on the card message, or archive and lock the thread or forum post once the event is over */
export const EventsThreadWork = Schema.Union([
    Schema.Struct({
        eventNo: Int(1),
        channelId: Id,
        title: threadTitle,
        action: Schema.Literal("open"),
        messageId: Id,
    }),
    Schema.Struct({
        eventNo: Int(1),
        channelId: Id,
        title: threadTitle,
        action: Schema.Literal("close"),
        threadId: Id,
    }),
])
export type EventsThreadWork = typeof EventsThreadWork.Type
export const EventsDeliveryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("event"), event: EventsDefinition }),
    Schema.Struct({
        type: Schema.Literal("deliveries"),
        deliveries: List(EventsDelivery, 20),
        nextAfterDeliveryId: optional(Token),
        threads: optional(List(EventsThreadWork, 10)),
    }),
    Schema.Struct({
        type: Schema.Literal("reservation"),
        status: Schema.Literal("reserved"),
        grant: EventsDeliveryGrant,
    }),
    Schema.Struct({
        type: Schema.Literal("reservation"),
        status: Schema.Literals(["waiting", "skipped", "cancelled", "terminal"]),
    }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean }),
])
export type EventsDeliveryResult = typeof EventsDeliveryResult.Type
export const EventsContext = SchedulesContext
export type EventsContext = typeof EventsContext.Type
export const EventsSource = Schema.Struct({ ...ModerationSource.fields, serverId: Id, context: EventsContext })
export type EventsSource = typeof EventsSource.Type
export const EventsManageOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), expectedRevision: Int(1), enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("threads"), expectedRevision: Int(1), enabled: Schema.Boolean }),
    Schema.Struct({
        type: Schema.Literal("create"),
        name: requestName,
        title: Text(256),
        description: optional(description),
        channelId: Id,
    }),
    Schema.Struct({
        type: Schema.Literal("calendar"),
        eventNo: Int(1),
        expectedRevision: Int(1),
        calendar: EventsCalendar,
    }),
    Schema.Struct({
        type: Schema.Literal("content"),
        eventNo: Int(1),
        expectedRevision: Int(1),
        title: Text(256),
        description,
    }),
    Schema.Struct({
        type: Schema.Literal("capacity"),
        eventNo: Int(1),
        expectedRevision: Int(1),
        capacity: EventsCapacity,
    }),
    Schema.Struct({
        type: Schema.Literal("reminders"),
        eventNo: Int(1),
        expectedRevision: Int(1),
        offsets: EventsReminderOffsets,
    }),
    Schema.Struct({
        type: Schema.Literal("template"),
        eventNo: Int(1),
        expectedRevision: Int(1),
        templateName: Schema.NullOr(requestName),
        expectedTemplateRevision: optional(Int(1)),
    }).check(Schema.makeFilter((value) => value.templateName === null || value.expectedTemplateRevision !== undefined)),
    Schema.Struct({
        type: Schema.Literals(["publish", "cancel", "reconcile"]),
        eventNo: Int(1),
        expectedRevision: Int(1),
    }),
    Schema.Struct({
        type: Schema.Literal("forget"),
        eventNo: Int(1),
        expectedRevision: Int(1),
        confirm: Schema.Literal("forget"),
    }),
])
export type EventsManageOperation = typeof EventsManageOperation.Type
// Dashboard jobs can also change a draft's destination
export const EventsConfigurationOperation = Schema.Union([
    EventsManageOperation,
    Schema.Struct({ type: Schema.Literal("destination"), eventNo: Int(1), expectedRevision: Int(1), channelId: Id }),
])
export type EventsConfigurationOperation = typeof EventsConfigurationOperation.Type
export const EventsManageRequest = Schema.Struct({ ...EventsSource.fields, operation: EventsManageOperation })
export type EventsManageRequest = typeof EventsManageRequest.Type
export const EventsQueryRequest = Schema.Struct({
    serverId: Id,
    context: EventsContext,
    operation: Schema.Union([
        Schema.Struct({ type: Schema.Literal("settings") }),
        Schema.Struct({ type: Schema.Literal("status") }),
        Schema.Struct({ type: Schema.Literal("list"), beforeEventNo: optional(Int(1)) }),
        Schema.Struct({ type: Schema.Literal("show"), eventNo: Int(1) }),
        /** Event names are unique in a server, so the bot finds the event a command names this way */
        Schema.Struct({ type: Schema.Literal("show"), name: requestName }),
        Schema.Struct({ type: Schema.Literal("dates"), eventNo: Int(1), afterOccurrenceNo: optional(Int()) }),
        Schema.Struct({
            type: Schema.Literal("attendees"),
            eventNo: Int(1),
            occurrenceNo: Int(1),
            afterUserId: optional(Id),
        }),
    ]),
})
export type EventsQueryRequest = typeof EventsQueryRequest.Type
export const EventsRsvpRequest = Schema.Struct({
    ...EventsSource.fields,
    eventNo: Int(1),
    occurrenceNo: Int(1),
    choice: EventsChoice,
})
export type EventsRsvpRequest = typeof EventsRsvpRequest.Type
export const EventsRsvpResult = Schema.Struct({
    duplicate: Schema.Boolean,
    accepted: Schema.Boolean,
    rsvp: Schema.NullOr(EventsRsvp),
    occurrence: EventsOccurrence,
})
export type EventsRsvpResult = typeof EventsRsvpResult.Type
export const EventsWorkRequest = Schema.Struct({
    serverId: Id,
    operation: Schema.Union([
        Schema.Struct({
            type: Schema.Literal("list"),
            cursor: optional(EventsMemberCursor),
            limit: optional(Int(1, EVENTS_BATCH)),
        }),
        Schema.Struct({ type: Schema.Literal("member-targets"), userId: Id, cursor: optional(EventsMemberCursor) }),
        Schema.Struct({
            type: Schema.Literal("claim"),
            eventNo: Int(1),
            occurrenceNo: Int(1),
            revision: Int(1),
            generation: Int(1),
            claimToken: EventsPromotionBinding.fields.claimToken,
        }),
        Schema.Struct({ type: Schema.Literal("promote"), binding: EventsPromotionBinding, context: EventsContext }),
        Schema.Struct({ type: Schema.Literal("defer"), binding: EventsPromotionBinding }),
        Schema.Struct({
            ...origin,
            type: Schema.Literal("observe"),
            ...EventsMemberTarget.fields,
            generation: Int(1),
            observedAt: Millis,
            memberAbsent: Schema.Literal(true),
        }),
    ]),
})
export type EventsWorkRequest = typeof EventsWorkRequest.Type
export const EventsAutomationContext = Schema.Struct({
    ...origin,
    observedAt: Millis,
    channelId: Id,
    botId: Id,
    botAuthorized: Schema.Literal(true),
})
export type EventsAutomationContext = typeof EventsAutomationContext.Type
export const EventsDeliveryRequest = Schema.Struct({
    serverId: Id,
    operation: Schema.Union([
        // Lists due reminders by the backend's clock
        Schema.Struct({ type: Schema.Literal("list") }),
        Schema.Struct({ type: Schema.Literal("status"), eventNo: Int(1), afterDeliveryId: optional(Token) }),
        Schema.Struct({ type: Schema.Literal("show"), eventNo: Int(1) }),
        Schema.Struct({
            type: Schema.Literal("reserve"),
            binding: EventsDeliveryBinding,
            context: EventsAutomationContext,
        }),
        Schema.Struct({ type: Schema.Literal("defer"), binding: EventsDeliveryBinding }),
        Schema.Struct({
            type: Schema.Literal("thread"),
            eventNo: Int(1),
            outcome: Schema.Literal("opened"),
            threadId: Id,
        }),
        Schema.Struct({
            type: Schema.Literal("thread"),
            eventNo: Int(1),
            outcome: Schema.Literals(["closed", "deferred"]),
        }),
    ]),
})
export type EventsDeliveryRequest = typeof EventsDeliveryRequest.Type
