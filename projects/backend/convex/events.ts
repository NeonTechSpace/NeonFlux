import {
    EVENTS_REMINDERS,
    EventsManageRequest,
    EventsQueryRequest,
    EventsRsvpRequest,
    EventsConfigurationOperation,
    type EventsDeliveryGrant,
    type EventsManageResult,
    type EventsQueryResult,
    type EventsResolvedDate,
    type EventsRsvpResult,
    eventsReminderProblem,
} from "@neonflux/contracts/events"
import { CIVIL_WINDOW } from "@neonflux/contracts/civil"
import type { BackupConfigValues } from "@neonflux/contracts/backup"
import { changeConfiguration } from "./configurationChange.ts"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { administrator } from "./moderationDomain.ts"
import { publishingContent, publishingName } from "./publishingDomain.ts"
import { reservePublishing, forgetConsumerPost } from "./publishing.ts"
import {
    advanceEvent,
    eventOffsets,
    epochOrder,
    EVENTS_DAY,
    renderEvent,
    validateEventCalendar,
} from "./eventsDomain.ts"
import {
    eventCardChannel,
    eventCount,
    eventReceipt,
    eventRow,
    eventSettings,
    eventState,
    lifecycle,
    liveOccurrences,
    nextOccurrence,
    eventResume,
    occurrenceRow,
    publicEvent,
    publicOccurrence,
    publicRsvp,
    releaseEvent,
    staleEvents,
    wakePromotion,
} from "./eventsStore.ts"
import { materializeCivil, resolveCivilInstant } from "./civilDomain.ts"
import { automationGate } from "./schedulesStore.ts"
import { serverPrefix } from "./generalSettings.ts"
import { decode, fail, integer, name, source, configurationSourceId, type ConfigurationIdentity } from "./validation.ts"
import { composerAdmin, composerContext, eventEligible } from "./publishingContext.ts"
import { ringWork } from "./workSignal.ts"

type BackupEventValue = BackupConfigValues["event"]

/** Fails an attempt that never reached Fluxer, and its post */
async function failUndispatched(
    ctx: MutationCtx,
    attempt: Doc<"publishingAttempts"> | null,
    post: Doc<"publishingPosts"> | null,
    now: number,
) {
    if (attempt?.outcome !== "pending" || attempt.dispatchedAt !== undefined) return
    await ctx.db.patch(attempt._id, {
        outcome: "failed",
        unresolved: false,
        noDispatch: true,
        finishedAt: now,
        expiresAt: now + 180 * EVENTS_DAY,
    })
    if (post?.attemptId === attempt._id) await ctx.db.patch(post._id, { outcome: "failed", updatedAt: now })
}
// Close only an unclaimed card, preserving already dispatched provider outcomes
async function closeUnclaimedCard(ctx: MutationCtx, event: Doc<"events">, now: number) {
    if (event.cardPostNo === undefined) return
    const post = await ctx.db
            .query("publishingPosts")
            .withIndex("by_server_post", (q) => q.eq("serverId", event.serverId).eq("postNo", event.cardPostNo!))
            .unique(),
        attempt = post?.attemptId ? await ctx.db.get(post.attemptId) : null
    await failUndispatched(ctx, attempt, post, now)
}
/** Reminder rows of an event that a change reads at most: 20 reminders on each of 26 stored dates */
const REMINDER_ROWS = CIVIL_WINDOW * EVENTS_REMINDERS
export async function invalidateEventDeliveries(ctx: MutationCtx, event: Doc<"events">) {
    const stale = await ctx.db
        .query("eventDeliveries")
        .withIndex("by_event_unattempted", (q) =>
            q
                .eq("serverId", event.serverId)
                .eq("eventNo", event.eventNo)
                .eq("attemptId", undefined)
                .lt("revision", event.revision),
        )
        .take(REMINDER_ROWS + 1)
    for (const row of stale) await ctx.db.delete(row._id)
    const rows = []
    for (const state of ["queued", "blocked", "reserved"] as const)
        rows.push(
            ...(await ctx.db
                .query("eventDeliveries")
                .withIndex("by_event_active", (q) =>
                    q
                        .eq("serverId", event.serverId)
                        .eq("eventNo", event.eventNo)
                        .eq("state", state)
                        .eq("claimedAt", undefined),
                )
                .take(REMINDER_ROWS + 1)),
        )
    if (rows.length > REMINDER_ROWS) fail(503, "Event delivery accounting unavailable")
    for (const row of rows) {
        const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (attempt?.dispatchedAt !== undefined || !["queued", "blocked", "reserved"].includes(row.state)) continue
        if (attempt?.outcome === "pending") {
            const post = await ctx.db
                .query("publishingPosts")
                .withIndex("by_server_post", (q) => q.eq("serverId", row.serverId).eq("postNo", row.postNo!))
                .unique()
            await failUndispatched(ctx, attempt, post, Date.now())
        }
        await ctx.db.patch(row._id, { state: "cancelled" })
    }
}
export async function queueEventReminders(ctx: MutationCtx, event: Doc<"events">) {
    // An event stores at most 26 open dates that have not started
    const occurrences = await ctx.db
        .query("eventOccurrences")
        .withIndex("by_event_state", (q) =>
            q
                .eq("serverId", event.serverId)
                .eq("eventNo", event.eventNo)
                .eq("state", "open")
                .gt("date.startsAt", Date.now()),
        )
        .take(CIVIL_WINDOW)
    for (const occurrence of occurrences)
        for (const offsetMinutes of event.reminderOffsets) {
            const dueAt = occurrence.date.startsAt - offsetMinutes * 60000
            if (dueAt < Date.now() || lifecycle({ ...occurrence.date, state: occurrence.state }) !== "open") continue
            if (
                await ctx.db
                    .query("eventDeliveries")
                    .withIndex("by_binding", (q) =>
                        q
                            .eq("serverId", event.serverId)
                            .eq("eventNo", event.eventNo)
                            .eq("occurrenceNo", occurrence.occurrenceNo)
                            .eq("revision", event.revision)
                            .eq("offsetMinutes", offsetMinutes),
                    )
                    .first()
            )
                continue
            await ctx.db.insert("eventDeliveries", {
                serverId: event.serverId,
                eventNo: event.eventNo,
                occurrenceNo: occurrence.occurrenceNo,
                revision: event.revision,
                channelId: event.channelId,
                offsetMinutes,
                dueAt,
                startsAt: occurrence.date.startsAt,
                state: "queued",
                nextCheckAt: dueAt,
                createdAt: Date.now(),
            })
        }
}
async function eventCard(
    ctx: MutationCtx,
    event: Doc<"events">,
    identity: ConfigurationIdentity,
    context: ReturnType<typeof composerContext>,
) {
    if (!context.botAuthorized || !context.actorAuthorized || context.channelId !== event.channelId)
        fail(403, "Invoker and destination permissions required")
    const existing =
        event.cardPostNo !== undefined
            ? await ctx.db
                  .query("publishingPosts")
                  .withIndex("by_server_post", (q) => q.eq("serverId", event.serverId).eq("postNo", event.cardPostNo!))
                  .unique()
            : null
    if (event.cardPostNo !== undefined && !existing) fail(503, "Event card unavailable")
    await eventEligible(ctx, event.serverId, context, event.channelId, context.actor.userId)
    const reserved = await reservePublishing(ctx, {
        serverId: event.serverId,
        sourceId: configurationSourceId(identity),
        actorId: context.actor.userId,
        botId: context.botId,
        channelId: eventCardChannel(event),
        // In a forum or media channel the card becomes the first message of its own post
        forumPostName: event.title,
        source:
            identity.source.kind === "chat"
                ? { type: "human", messageId: identity.source.messageId, createdAt: identity.createdAt }
                : {
                      type: "dashboard-configuration",
                      jobId: identity.source.jobId,
                      family: "events",
                      createdAt: identity.createdAt,
                  },
        provenance: {
            type: "event",
            eventNo: event.eventNo,
            revision: event.revision,
            ...(event.template ? { template: { name: event.template.name, revision: event.template.revision } } : {}),
        },
        consumer: { type: "event", eventNo: event.eventNo, revision: event.revision, purpose: "card" },
        content: renderEvent(
            event,
            await serverPrefix(ctx, event.serverId),
            undefined,
            nextOccurrence(await liveOccurrences(ctx, event))?.date,
        ),
        ...(existing ? { existing } : {}),
    })
    await ctx.db.patch(event._id, { cardPostNo: reserved.post.postNo })
    return reserved.grant as EventsDeliveryGrant
}
async function forgetEvent(ctx: MutationCtx, event: Doc<"events">) {
    if (publicEvent(event).state !== "cancelled" && publicEvent(event).state !== "completed" && event.state !== "draft")
        fail(409, "Cancel event before forgetting")
    if (
        await ctx.db
            .query("publishingAttempts")
            .withIndex("by_event_unresolved", (q) =>
                q.eq("serverId", event.serverId).eq("consumer.eventNo", event.eventNo).eq("unresolved", true),
            )
            .first()
    )
        fail(409, "Unresolved event publication preserved")
    const posts = await ctx.db
        .query("publishingPosts")
        .withIndex("by_event", (q) => q.eq("serverId", event.serverId).eq("consumer.eventNo", event.eventNo))
        .take(21)
    await ctx.db.patch(event._id, { forgetting: true })
    let removed = 0
    for (const post of posts.slice(0, 20)) {
        await forgetConsumerPost(ctx, post)
        if (post.postNo === event.cardPostNo) await ctx.db.patch(event._id, { cardPostNo: undefined })
        removed++
    }
    if (posts.length > 20) return { complete: false, removed }
    const occurrences = await ctx.db
        .query("eventOccurrences")
        .withIndex("by_event", (q) => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo))
        .take(27)
    for (const occurrence of occurrences) {
        const remaining = 20 - removed
        const rows = await ctx.db
            .query("eventRsvps")
            .withIndex("by_occurrence", (q) =>
                q
                    .eq("serverId", event.serverId)
                    .eq("eventNo", event.eventNo)
                    .eq("occurrenceNo", occurrence.occurrenceNo),
            )
            .take(remaining + 1)
        for (const row of rows.slice(0, remaining)) {
            await ctx.db.delete(row._id)
            await eventCount(ctx, event.serverId, "rsvps", -1)
            removed++
        }
        if (rows.length > remaining) return { complete: false, removed }
        if (removed >= 20) return { complete: false, removed }
        await ctx.db.delete(occurrence._id)
        removed++
    }
    const deliveries = await ctx.db
        .query("eventDeliveries")
        .withIndex("by_event", (q) => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo))
        .take(21)
    for (const delivery of deliveries.slice(0, 20 - removed)) {
        await ctx.db.delete(delivery._id)
        removed++
    }
    if (
        await ctx.db
            .query("eventDeliveries")
            .withIndex("by_event", (q) => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo))
            .first()
    )
        return { complete: false, removed }
    await ctx.db.delete(event._id)
    if (!event.released) await eventCount(ctx, event.serverId, "definitions", -1)
    return { complete: true, removed: removed + 1 }
}
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<EventsManageResult> => {
        const input = decode(EventsManageRequest, request),
            now = Date.now(),
            identity = source(input, now),
            context = composerContext(input.context),
            op = input.operation
        await composerAdmin(
            ctx,
            identity.serverId,
            context,
            op.type === "cancel" ||
                op.type === "forget" ||
                op.type === "reconcile" ||
                (op.type === "settings" && op.enabled === false),
        )
        if (!(await eventReceipt(ctx, identity, context.actor.userId, op))) return { duplicate: true }
        const apply = () =>
            applyEventsManagement(
                ctx,
                {
                    serverId: identity.serverId,
                    actorId: context.actor.userId,
                    createdAt: identity.createdAt,
                    source: { kind: "chat", messageId: identity.messageId },
                },
                context,
                op,
                now,
            )
        if (op.type === "reconcile") return apply()
        return changeConfiguration(
            ctx,
            identity.serverId,
            "events",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: context.actor.userId, source: "command" },
                operation: op,
            },
            apply,
        )
    },
})

/** Replies one `mine` page reads, each with at most one event and one date read */
const MINE_PAGE = 200
export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<EventsQueryResult> => {
        const input = decode(EventsQueryRequest, request),
            serverId = input.serverId
        const context = composerContext(input.context),
            op = input.operation,
            state = await eventSettings(ctx, serverId),
            settings = {
                enabled: state?.enabled ?? false,
                revision: state?.revision ?? 1,
                threads: state?.threads ?? false,
            }
        const admin = administrator(context.actor)
        if (op.type === "settings" || op.type === "status") {
            await composerAdmin(ctx, serverId, context, true)
            return op.type === "settings"
                ? { type: "settings", settings }
                : {
                      type: "status",
                      settings,
                      definitions: (state?.definitions ?? 0) - (await staleEvents(ctx, serverId)),
                      rsvps: state?.rsvps ?? 0,
                      receipts: state?.receipts ?? 0,
                  }
        }
        if (!admin && (!settings.enabled || !context.member || context.member.userId !== context.actor.userId))
            fail(403, "Event discovery unavailable")
        await automationGate(ctx, serverId, admin)
        if (op.type === "list") {
            if (!admin) await eventEligible(ctx, serverId, context, context.channelId, context.actor.userId)
            const before = op.beforeEventNo === undefined ? Number.MAX_SAFE_INTEGER : op.beforeEventNo
            const rows = await ctx.db
                .query("events")
                .withIndex("by_channel", (q) =>
                    q.eq("serverId", serverId).eq("channelId", context.channelId).lt("eventNo", before),
                )
                .order("desc")
                .take(51)
            const visible = rows.filter((r) => !r.forgetting && (admin || r.state !== "draft")),
                selected = visible.slice(0, 10)
            return {
                type: "events",
                events: selected.map((row) => publicEvent(row)),
                ...(visible.length > 10 ? { nextBeforeEventNo: selected.at(-1)!.eventNo } : {}),
            }
        }
        if (op.type === "mine") {
            const member = admin
                ? context.member
                : await eventEligible(ctx, serverId, context, context.channelId, context.actor.userId)
            if (!member || member.userId !== context.actor.userId) fail(403, "Current visible membership required")
            // A page reads the member's replies in event and date order from the cursor. The bot reads every page and shows the
            // soonest overall, so no number of events, dates or kept replies limits the answer. Rows kept from an earlier
            // membership are skipped
            const cursor = op.cursor
            const sameEvent = cursor
                ? await ctx.db
                      .query("eventRsvps")
                      .withIndex("by_member", (q) =>
                          q
                              .eq("serverId", serverId)
                              .eq("userId", member.userId)
                              .eq("eventNo", cursor.eventNo)
                              .gt("occurrenceNo", cursor.occurrenceNo),
                      )
                      .take(MINE_PAGE + 1)
                : []
            const rows = [
                ...sameEvent,
                ...(sameEvent.length > MINE_PAGE
                    ? []
                    : await ctx.db
                          .query("eventRsvps")
                          .withIndex("by_member", (q) =>
                              q
                                  .eq("serverId", serverId)
                                  .eq("userId", member.userId)
                                  .gt("eventNo", cursor?.eventNo ?? 0),
                          )
                          .take(MINE_PAGE + 1 - sameEvent.length)),
            ]
            const page = rows.slice(0, MINE_PAGE),
                last = page.at(-1)
            const events = new Map<number, Doc<"events"> | undefined>(),
                entries: Extract<EventsQueryResult, { type: "mine" }>["entries"][number][] = []
            for (const row of page) {
                const choice = row.choice
                if ((choice !== "going" && choice !== "maybe") || row.joinedAt !== member.joinedAt) continue
                if (!events.has(row.eventNo)) {
                    const found = await ctx.db
                        .query("events")
                        .withIndex("by_number", (q) => q.eq("serverId", serverId).eq("eventNo", row.eventNo))
                        .unique()
                    events.set(
                        row.eventNo,
                        found && found.channelId === context.channelId && found.state !== "draft" && !found.forgetting
                            ? found
                            : undefined,
                    )
                }
                const event = events.get(row.eventNo)
                if (!event) continue
                const occurrence = await ctx.db
                    .query("eventOccurrences")
                    .withIndex("by_number", (q) =>
                        q.eq("serverId", serverId).eq("eventNo", row.eventNo).eq("occurrenceNo", row.occurrenceNo),
                    )
                    .unique()
                const state = occurrence && lifecycle({ state: occurrence.state, ...occurrence.date })
                if (state !== "open" && state !== "started") continue
                entries.push({
                    eventNo: event.eventNo,
                    name: event.name,
                    title: event.title,
                    occurrenceNo: row.occurrenceNo,
                    startsAt: occurrence!.date.startsAt,
                    choice,
                })
            }
            entries.sort((a, b) => a.startsAt - b.startsAt || a.eventNo - b.eventNo || a.occurrenceNo - b.occurrenceNo)
            return {
                type: "mine",
                entries: entries.slice(0, 20),
                more: entries.length > 20,
                ...(rows.length > MINE_PAGE && last
                    ? { nextCursor: { eventNo: last.eventNo, occurrenceNo: last.occurrenceNo } }
                    : {}),
            }
        }
        // Chat commands name an event, which is unique in a server through the by_name index
        const byName = op.type === "show" && "name" in op
        const event = byName
            ? ((await ctx.db
                  .query("events")
                  .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("name", name(op.name)))
                  .unique()) ?? fail(404, "Event not found"))
            : await eventRow(ctx, serverId, op.eventNo)
        if (!admin) {
            if (event.state === "draft" || event.forgetting) fail(403, "Event unavailable")
            if (context.channelId !== event.channelId)
                fail(403, "Use this in the channel the event was posted in", "REFUSED")
            await eventEligible(ctx, serverId, context, event.channelId, context.actor.userId)
        }
        if (op.type === "show")
            return {
                type: "event",
                event: {
                    ...publicEvent(event, nextOccurrence(await liveOccurrences(ctx, event))),
                    ...eventResume(event, Date.now()),
                },
            }
        if (op.type === "dates") {
            // The list starts at the earliest date that has not ended. Ended dates show only once none are left
            const now = Date.now(),
                live = (await liveOccurrences(ctx, event)).filter((row) => row.date.endsAt > now),
                first = Math.min(...live.map((row) => row.occurrenceNo)),
                after = Math.max(op.afterOccurrenceNo ?? 0, Number.isFinite(first) ? first - 1 : 0)
            const rows = await ctx.db
                    .query("eventOccurrences")
                    .withIndex("by_number", (q) =>
                        q.eq("serverId", serverId).eq("eventNo", event.eventNo).gt("occurrenceNo", after),
                    )
                    .take(11),
                selected = rows.slice(0, 10)
            return {
                type: "dates",
                dates: selected.map(publicOccurrence),
                ...(rows.length > 10 ? { nextAfterOccurrenceNo: selected.at(-1)!.occurrenceNo } : {}),
            }
        }
        if (op.type === "attendees") {
            if (context.channelId !== event.channelId)
                fail(403, "The attendee list is shown only in the channel the event was posted in", "REFUSED")
            const occurrence = await occurrenceRow(ctx, serverId, event.eventNo, op.occurrenceNo),
                after = op.afterUserId === undefined ? "" : op.afterUserId
            const rows = await ctx.db
                    .query("eventRsvps")
                    .withIndex("by_occurrence", (q) =>
                        q
                            .eq("serverId", serverId)
                            .eq("eventNo", event.eventNo)
                            .eq("occurrenceNo", occurrence.occurrenceNo)
                            .gt("userId", after),
                    )
                    .take(11),
                selected = rows.slice(0, 10)
            return {
                type: "attendees",
                attendees: selected.map(publicRsvp),
                ...(rows.length > 10 ? { nextAfterUserId: selected.at(-1)!.userId } : {}),
            }
        }
        fail(400, "Invalid event query")
    },
})

/** The earliest date of an event that still takes RSVPs, which has not started and is not cancelled */
async function nextOpenOccurrence(ctx: MutationCtx, event: Doc<"events">) {
    return (
        (await ctx.db
            .query("eventOccurrences")
            .withIndex("by_event_state", (q) =>
                q
                    .eq("serverId", event.serverId)
                    .eq("eventNo", event.eventNo)
                    .eq("state", "open")
                    .gt("date.startsAt", Date.now()),
            )
            .first()) ?? undefined
    )
}
/** The date that a dateless RSVP from this message already answered for, read from its receipt */
async function datelessReceipt(
    ctx: MutationCtx,
    identity: { serverId: string; messageId: string },
    eventNo: number,
): Promise<number | undefined> {
    const receipt = await ctx.db
        .query("eventReceipts")
        .withIndex("by_source", (q) => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId))
        .unique()
    const key = receipt
        ? (JSON.parse(receipt.operationKey) as { dateless?: unknown; eventNo?: unknown; occurrenceNo?: unknown } | null)
        : undefined
    return key?.dateless === true && key.eventNo === eventNo && typeof key.occurrenceNo === "number"
        ? key.occurrenceNo
        : undefined
}

export const rsvp = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<EventsRsvpResult> => {
        const input = decode(EventsRsvpRequest, request),
            identity = source(input, Date.now()),
            context = composerContext(input.context)
        const event = await eventRow(ctx, identity.serverId, input.eventNo),
            dateless = input.occurrenceNo === undefined
        // A replay of a dateless RSVP answers for the date its first handling chose, which its receipt names
        const replayed = dateless ? await datelessReceipt(ctx, identity, event.eventNo) : undefined
        const occurrence = !dateless
            ? await occurrenceRow(ctx, identity.serverId, event.eventNo, input.occurrenceNo)
            : replayed !== undefined
              ? await occurrenceRow(ctx, identity.serverId, event.eventNo, replayed)
              : await nextOpenOccurrence(ctx, event)
        const closed = !(await eventSettings(ctx, event.serverId))?.enabled || event.forgetting
        if (context.channelId !== event.channelId)
            fail(403, "RSVPs are only taken in the channel the event was posted in. Use that channel", "REFUSED")
        if (!closed && !occurrence) {
            const prefix = await serverPrefix(ctx, event.serverId)
            fail(
                403,
                `No date of this event takes RSVPs now. Check its dates with ${prefix}event dates ${event.name}`,
                "REFUSED",
            )
        }
        if (
            closed ||
            !occurrence ||
            (replayed === undefined && lifecycle({ state: occurrence.state, ...occurrence.date }) !== "open")
        )
            fail(403, "RSVPs are closed because the event is cancelled or over, or events are off", "REFUSED")
        const member = await eventEligible(ctx, event.serverId, context, event.channelId, context.actor.userId)
        const old = await ctx.db
            .query("eventRsvps")
            .withIndex("by_occurrence", (q) =>
                q
                    .eq("serverId", event.serverId)
                    .eq("eventNo", event.eventNo)
                    .eq("occurrenceNo", occurrence.occurrenceNo)
                    .eq("userId", member.userId),
            )
            .unique()
        const response = async (accepted: boolean, duplicate = false): Promise<EventsRsvpResult> => {
            const current = await ctx.db
                .query("eventRsvps")
                .withIndex("by_occurrence", (q) =>
                    q
                        .eq("serverId", event.serverId)
                        .eq("eventNo", event.eventNo)
                        .eq("occurrenceNo", occurrence.occurrenceNo)
                        .eq("userId", member.userId),
                )
                .unique()
            return {
                duplicate,
                accepted,
                rsvp: current ? publicRsvp(current) : null,
                occurrence: publicOccurrence((await ctx.db.get(occurrence._id))!),
            }
        }
        const receiptBinding = {
            eventNo: event.eventNo,
            occurrenceNo: occurrence.occurrenceNo,
            choice: input.choice,
            joinedAt: member.joinedAt,
            ...(dateless ? { dateless: true } : {}),
        }
        if (!(await eventReceipt(ctx, identity, member.userId, receiptBinding))) return response(false, true)
        if (identity.createdAt < Date.parse(member.joinedAt) || identity.createdAt < (event.activatedAt ?? Infinity))
            fail(409, "RSVP predates membership or activation")
        // Source message order decides between competing RSVP writes from the same membership
        const olderEpoch =
            old &&
            (epochOrder(member.joinedAt) < epochOrder(old.joinedAt) ||
                (member.joinedAt !== old.joinedAt && epochOrder(member.joinedAt) === epochOrder(old.joinedAt)))
        const olderSource =
            old &&
            (identity.createdAt < old.acceptedCreatedAt ||
                (identity.createdAt === old.acceptedCreatedAt &&
                    BigInt(identity.messageId) <= BigInt(old.acceptedMessageId)))
        if (olderEpoch || olderSource) return response(false)
        if (old && context.observedAt < old.observedAt) return response(false)
        const sameEpoch = old?.joinedAt === member.joinedAt,
            choice = input.choice,
            keepsGoing = sameEpoch && old.choice === "going" && choice === "going"
        const going = occurrence.going - (old?.allocation === "seat" && !keepsGoing ? 1 : 0),
            waitlisted = occurrence.waitlisted - (old?.allocation === "waitlist" && !keepsGoing ? 1 : 0)
        const allocation = keepsGoing
            ? old.allocation
            : choice === "going"
              ? waitlisted === 0 && (occurrence.capacity === null || going < occurrence.capacity)
                  ? "seat"
                  : "waitlist"
              : "none"
        const fields = {
            joinedAt: member.joinedAt,
            membershipGeneration: sameEpoch ? old.membershipGeneration : (old?.membershipGeneration ?? 0) + 1,
            revision: (old?.revision ?? 0) + 1,
            choice,
            allocation,
            queueOrder: keepsGoing ? old.queueOrder : allocation === "waitlist" ? occurrence.nextQueueOrder : undefined,
            deferredUntil: undefined,
            acceptedCreatedAt: identity.createdAt,
            acceptedMessageId: identity.messageId,
            observedAt: context.observedAt,
        }
        if (old) await ctx.db.patch(old._id, fields)
        else {
            await eventCount(ctx, event.serverId, "rsvps", 1)
            const { deferredUntil, queueOrder, ...required } = fields
            await ctx.db.insert("eventRsvps", {
                serverId: event.serverId,
                eventNo: event.eventNo,
                occurrenceNo: occurrence.occurrenceNo,
                userId: member.userId,
                createdAt: Date.now(),
                ...required,
                ...(queueOrder !== undefined ? { queueOrder } : {}),
            })
        }
        await ctx.db.patch(occurrence._id, {
            participationStarted: true,
            rsvps: occurrence.rsvps + (old ? 0 : 1),
            nextQueueOrder: occurrence.nextQueueOrder + (!keepsGoing && allocation === "waitlist" ? 1 : 0),
        })
        await ctx.db.patch(event._id, { participationStarted: true })
        await wakePromotion(ctx, (await ctx.db.get(occurrence._id))!, {
            going: going + (!keepsGoing && allocation === "seat" ? 1 : 0),
            waitlisted: waitlisted + (!keepsGoing && allocation === "waitlist" ? 1 : 0),
        })
        return response(true)
    },
})

/**
 * A backup restore's event, by name: a draft with the archived settings, made or changed in place. It is never published, so it posts no
 * card and takes no responses. The calendar comes only while every date is ahead, which the feature's own calendar check decides, and a
 * published, cancelled or forgotten event stays as it is
 */
export async function restoreEventDraft(ctx: MutationCtx, serverId: string, value: BackupEventValue, now: number) {
    const eventName = name(value.name),
        state = await eventState(ctx, serverId),
        calendar = value.calendar ? validateEventCalendar(value.calendar, now) : undefined
    const fields = {
        channelId: value.channelId,
        title: value.title,
        description: value.description,
        capacity: value.capacity,
        reminderOffsets: eventOffsets(value.reminderOffsets),
        ...(value.template
            ? { template: { ...value.template, content: publishingContent(value.template.content) } }
            : {}),
        ...(calendar ? { calendar, endsAt: calendar.dates.at(-1)!.endsAt } : {}),
        updatedAt: now,
    }
    let event = await ctx.db
        .query("events")
        .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("name", eventName))
        .unique()
    if (event && (event.state !== "draft" || event.forgetting)) fail(409, "Only a draft event can be restored")
    // A setting the archive leaves out is cleared, as the draft holds only what it had
    if (event)
        await ctx.db.patch(event._id, {
            template: undefined,
            calendar: undefined,
            endsAt: undefined,
            firstStartsAt: undefined,
            nextIndex: undefined,
            lastSkipped: undefined,
            ...fields,
            revision: advanceEvent(event.revision),
        })
    else {
        await eventCount(ctx, serverId, "definitions", 1)
        await ctx.db.insert("events", {
            serverId,
            eventNo: state.nextEventNo,
            name: eventName,
            revision: 1,
            ...fields,
            state: "draft",
            participationStarted: false,
            createdAt: now,
        })
        await ctx.db.patch(state._id, { nextEventNo: advanceEvent(state.nextEventNo) })
    }
    event = (await ctx.db
        .query("events")
        .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("name", eventName))
        .unique())!
    const occurrences = await ctx.db
        .query("eventOccurrences")
        .withIndex("by_event", (q) => q.eq("serverId", serverId).eq("eventNo", event!.eventNo))
        .take(CIVIL_WINDOW + 1)
    for (const occurrence of occurrences) await ctx.db.delete(occurrence._id)
    await addOccurrences(ctx, event, calendar?.dates ?? [], "draft", event.revision, now)
}
export async function applyEventsManagement(
    ctx: MutationCtx,
    identity: ConfigurationIdentity,
    context: ReturnType<typeof composerContext> | undefined,
    value: unknown,
    now: number,
): Promise<EventsManageResult> {
    const op = decode(EventsConfigurationOperation, value),
        state = await eventState(ctx, identity.serverId)
    if (op.type === "settings" || op.type === "threads") {
        if (state.revision !== op.expectedRevision) fail(409, "Event settings changed")
        if (
            op.type === "settings" &&
            op.enabled &&
            (await ctx.db
                .query("responseDefinitions")
                .withIndex("by_server_kind_name", (q) =>
                    q.eq("serverId", identity.serverId).eq("kind", "custom").eq("name", "event"),
                )
                .first())
        )
            fail(409, "Event command namespace occupied")
        // Discussion threads apply to events published while they are on
        await ctx.db.patch(state._id, {
            [op.type === "settings" ? "enabled" : "threads"]: op.enabled,
            revision: advanceEvent(state.revision),
        })
        // Reminders that came due while events were off are listed again only from now on, so the bot hears of them at once
        if (op.type === "settings" && op.enabled && !state.enabled) await ringWork(ctx)
        const next = (await ctx.db.get(state._id))!
        return {
            duplicate: false,
            type: "settings",
            settings: { enabled: next.enabled, revision: next.revision, threads: next.threads ?? false },
        }
    }
    if (op.type === "create") {
        if (!context) fail(403, "Native administrator required")
        const eventName = name(op.name),
            channelId = op.channelId
        if (
            await ctx.db
                .query("events")
                .withIndex("by_name", (q) => q.eq("serverId", identity.serverId).eq("name", eventName))
                .unique()
        )
            fail(409, "An event with that name already exists. Choose another name", "REFUSED")
        const description = op.description ?? ""
        await eventCount(ctx, identity.serverId, "definitions", 1)
        const id = await ctx.db.insert("events", {
            serverId: identity.serverId,
            eventNo: state.nextEventNo,
            name: eventName,
            revision: 1,
            channelId,
            title: op.title,
            description,
            capacity: null,
            reminderOffsets: [1440, 60],
            state: "draft",
            participationStarted: false,
            createdAt: now,
            updatedAt: now,
        })
        await ctx.db.patch(state._id, { nextEventNo: advanceEvent(state.nextEventNo) })
        return { duplicate: false, type: "event", event: publicEvent((await ctx.db.get(id))!) }
    }
    const event = await eventRow(ctx, identity.serverId, op.eventNo, op.expectedRevision)
    if (op.type === "forget") {
        return { duplicate: false, type: "forgotten", eventNo: event.eventNo, ...(await forgetEvent(ctx, event)) }
    }
    if (op.type === "reconcile") {
        return { duplicate: false, type: "event", event: publicEvent(event) }
    }
    if (event.forgetting || event.state === "cancelled" || publicEvent(event).state === "completed")
        fail(409, "This event is cancelled or finished, so it can no longer change", "REFUSED")
    const occurrences = await liveOccurrences(ctx, event)
    if (op.type === "publish") {
        if (!state.enabled)
            fail(403, "Events are off. The server owner or an Administrator can turn them on", "REFUSED")
        if (
            event.state !== "draft" ||
            !event.calendar ||
            !occurrences.length ||
            occurrences.some((o) => o.date.startsAt <= now)
        )
            fail(409, "Future draft calendar required")
        if (!context) fail(403, "Native administrator required")
        const grant = await eventCard(ctx, event, identity, context)
        await ctx.db.patch(event._id, { state: "open", activatedAt: now, updatedAt: now })
        for (const occurrence of occurrences) await ctx.db.patch(occurrence._id, { state: "open" })
        await extendEvent(ctx, (await ctx.db.get(event._id))!, now)
        await queueEventReminders(ctx, (await ctx.db.get(event._id))!)
        return { duplicate: false, type: "event", event: publicEvent((await ctx.db.get(event._id))!), grant }
    }
    if (op.type === "cancel") {
        const revision = advanceEvent(event.revision)
        await invalidateEventDeliveries(ctx, event)
        for (const occurrence of occurrences) await cancelOccurrence(ctx, occurrence, now, revision)
        await closeUnclaimedCard(ctx, event, now)
        await ctx.db.patch(event._id, {
            state: "cancelled",
            revision,
            updatedAt: now,
            terminalAt: now,
            historyExpiresAt: now + 180 * EVENTS_DAY,
            // A discussion thread, or a forum post published with threads on, closes now, and one not yet started never starts
            threadDueAt: event.threadId || (event.postId && event.threadDueAt !== undefined) ? now : undefined,
            extendAt: undefined,
            notice: undefined,
            noticeDueAt: undefined,
        })
        await releaseEvent(ctx, event)
        return { duplicate: false, type: "event", event: publicEvent((await ctx.db.get(event._id))!) }
    }
    // Fields set to undefined are removed
    type Cleared = "template" | "firstStartsAt" | "nextIndex" | "lastSkipped"
    const patch: Partial<Omit<Doc<"events">, "_id" | "_creationTime" | Cleared>> & {
        [K in Cleared]?: Doc<"events">[K] | undefined
    } = { revision: advanceEvent(event.revision), updatedAt: now }
    const moves: NonNullable<Doc<"events">["notice"]>["moves"] = []
    // The first date stays where it was once it has started
    const started = (event.firstStartsAt ?? event.calendar?.dates[0]?.startsAt ?? Infinity) <= now
    if (op.type === "calendar") {
        const calendar = validateEventCalendar(op.calendar, now)
        // A repeat with more than 26 dates stores only its next 26, so a reminder further ahead than they reach would never come
        const reminders = eventsReminderProblem(calendar, event.reminderOffsets)
        if (reminders) fail(400, reminders, "REFUSED")
        if (event.state === "draft") {
            // A draft has no responses and has not begun, whatever its dates say
            for (const occurrence of occurrences) await ctx.db.delete(occurrence._id)
            await addOccurrences(ctx, event, calendar.dates, "draft", patch.revision!, now)
            patch.endsAt = calendar.dates.at(-1)!.endsAt
            patch.firstStartsAt = undefined
            patch.nextIndex = undefined
            patch.lastSkipped = undefined
        } else {
            // Dates that have started stay as they were. The open ones take the new dates in order and keep their numbers,
            // replies and waitlists, new dates are added, and open dates past a shorter end are cancelled
            const open = occurrences.filter((o) => lifecycle({ state: o.state, ...o.date }, now) === "open")
            // The first dates end before a later time that does not resolve, so the plan's next dates are added here first, and
            // open dates past that time keep their numbers too
            const more =
                open.length > calendar.dates.length
                    ? materializeCivil(calendar, calendar.dates.length, calendar.dates.length, now)
                    : undefined
            const targets = [
                ...calendar.dates,
                ...(more?.dates ?? []).map((date) => ({
                    localMinute: date.localMinute,
                    startsAt: date.instantAt,
                    endsAt: date.instantAt + calendar.durationMinutes * 60000,
                    offsetMinutes: date.offsetMinutes,
                })),
            ]
            for (const [index, occurrence] of open.entries()) {
                const date = targets[index]
                if (!date) {
                    await cancelOccurrence(ctx, occurrence, now)
                    if (occurrence.rsvps)
                        moves.push({
                            occurrenceNo: occurrence.occurrenceNo,
                            fromStartsAt: occurrence.date.startsAt,
                            cancelled: true,
                        })
                } else if (
                    date.startsAt !== occurrence.date.startsAt ||
                    date.endsAt !== occurrence.date.endsAt ||
                    date.localMinute !== occurrence.date.localMinute
                ) {
                    await ctx.db.patch(occurrence._id, { date })
                    if (occurrence.rsvps && date.startsAt !== occurrence.date.startsAt)
                        moves.push({ occurrenceNo: occurrence.occurrenceNo, fromStartsAt: occurrence.date.startsAt })
                }
            }
            await addOccurrences(ctx, event, targets.slice(open.length), "open", patch.revision!, now)
            patch.endsAt = Math.max(
                targets.at(-1)!.endsAt,
                ...occurrences.filter((o) => !open.includes(o)).map((o) => o.date.endsAt),
            )
            patch.firstStartsAt = started
                ? (event.firstStartsAt ?? event.calendar!.dates[0]!.startsAt)
                : calendar.dates[0]!.startsAt
            patch.nextIndex = more?.next
            patch.lastSkipped = more?.skipped
        }
        patch.calendar = calendar
        // An open discussion closes at the new end
        if ((event.postId || event.threadId) && event.threadDueAt !== undefined) patch.threadDueAt = patch.endsAt
    } else if (op.type === "move") {
        const calendar = event.calendar
        if (!calendar) fail(409, "Calendar required")
        const occurrence =
                occurrences.find((o) => o.occurrenceNo === op.occurrenceNo) ??
                (await occurrenceRow(ctx, event.serverId, event.eventNo, op.occurrenceNo)),
            current = lifecycle({ state: occurrence.state, ...occurrence.date }, now),
            date = op.date
        if (current === "cancelled")
            fail(409, `Date #${occurrence.occurrenceNo} was cancelled, so it stays as it was`, "REFUSED")
        if (current !== "open" && current !== "draft")
            fail(409, `Date #${occurrence.occurrenceNo} has already started, so it stays as it was`, "REFUSED")
        const resolved = resolveCivilInstant(date.localMinute, calendar.zone, op.fold)
        if (
            resolved.instantAt !== date.startsAt ||
            resolved.offsetMinutes !== date.offsetMinutes ||
            date.endsAt !== date.startsAt + calendar.durationMinutes * 60000
        )
            fail(400, "Civil offset or UTC binding changed")
        if (date.startsAt <= now) fail(400, "Choose a time in the future", "REFUSED")
        await ctx.db.patch(occurrence._id, { date })
        if (occurrence.rsvps && date.startsAt !== occurrence.date.startsAt)
            moves.push({ occurrenceNo: occurrence.occurrenceNo, fromStartsAt: occurrence.date.startsAt })
        const dates = occurrences.map((o) => (o._id === occurrence._id ? date : o.date))
        patch.endsAt = Math.max(date.endsAt, ...dates.map((d) => d.endsAt))
        if (!started) patch.firstStartsAt = Math.min(date.startsAt, ...dates.map((d) => d.startsAt))
        if ((event.postId || event.threadId) && event.threadDueAt !== undefined) patch.threadDueAt = patch.endsAt
    } else if (op.type === "destination") {
        if (event.state !== "draft" || event.participationStarted || event.cardPostNo !== undefined)
            fail(409, "Published event destination is immutable")
        patch.channelId = op.channelId
        if (!context) fail(403, "Native administrator required")
        await eventEligible(ctx, event.serverId, context, patch.channelId, context.actor.userId)
    } else if (op.type === "content") {
        patch.title = op.title
        patch.description = op.description
    } else if (op.type === "capacity") {
        patch.capacity = op.capacity
        if (patch.capacity !== null && occurrences.some((o) => o.date.startsAt > now && o.going > patch.capacity!))
            fail(409, "A date ahead already has more members going than that", "REFUSED")
    } else if (op.type === "reminders") {
        patch.reminderOffsets = eventOffsets(op.offsets)
        const reminders = event.calendar && eventsReminderProblem(event.calendar, patch.reminderOffsets)
        if (reminders) fail(400, reminders, "REFUSED")
    } else if (op.type === "template") {
        if (op.templateName === null) patch.template = undefined
        else {
            const template = await ctx.db
                .query("publishingDrafts")
                .withIndex("by_server_kind_name", (q) =>
                    q.eq("serverId", event.serverId).eq("kind", "template").eq("name", publishingName(op.templateName)),
                )
                .unique()
            if (!template) fail(404, "Template not found")
            if (template.revision !== op.expectedTemplateRevision) fail(409, "Template revision changed")
            patch.template = {
                name: template.name,
                revision: template.revision,
                content: publishingContent(template.content),
            }
        }
    } else fail(400, "Invalid event operation")
    // Members who replied to a moved or cancelled date are told by DM. A change joins a notice that has not begun going out.
    // Once members of a notice were claimed, a later change waits as its next notice, so no member hears of one change twice
    if (moves.length) {
        const unfinished = event.noticeDueAt !== undefined ? event.notice : undefined,
            joined = (older: readonly (typeof moves)[number][]) =>
                [...moves, ...older.filter((old) => !moves.some((m) => m.occurrenceNo === old.occurrenceNo))].slice(
                    0,
                    CIVIL_WINDOW,
                )
        patch.notice = unfinished?.cursor
            ? {
                  ...unfinished,
                  next: { revision: patch.revision!, moves: joined(unfinished.next?.moves ?? []) },
              }
            : { revision: patch.revision!, moves: joined(unfinished?.moves ?? []), sent: 0, failed: 0 }
        patch.noticeDueAt = now
    }
    await invalidateEventDeliveries(ctx, event)
    await closeUnclaimedCard(ctx, event, now)
    await ctx.db.patch(event._id, patch)
    for (const occurrence of await liveOccurrences(ctx, event)) {
        await ctx.db.patch(occurrence._id, { revision: patch.revision! })
        await wakePromotion(ctx, (await ctx.db.get(occurrence._id))!, {
            ...(patch.capacity !== undefined && occurrence.date.startsAt > now ? { capacity: patch.capacity } : {}),
        })
    }
    if (event.state !== "draft" && (op.type === "calendar" || op.type === "move"))
        await extendEvent(ctx, (await ctx.db.get(event._id))!, now)
    const next = (await ctx.db.get(event._id))!,
        first = nextOccurrence(await liveOccurrences(ctx, next))
    let grant: EventsDeliveryGrant | undefined
    if (next.calendar) renderEvent(next, await serverPrefix(ctx, next.serverId), undefined, first?.date)
    if (next.cardPostNo !== undefined) {
        if (!context) fail(403, "Native administrator required")
        grant = await eventCard(ctx, next, identity, context)
    }
    if (next.state !== "draft") await queueEventReminders(ctx, next)
    if (moves.length) await ringWork(ctx)
    return {
        duplicate: false,
        type: "event",
        event: publicEvent((await ctx.db.get(event._id))!, first),
        ...(grant ? { grant } : {}),
    }
}
/** Ends a date that will not run. Its replies stay 30 days, so a notice can still reach the members who gave them */
async function cancelOccurrence(ctx: MutationCtx, occurrence: Doc<"eventOccurrences">, now: number, revision?: number) {
    await ctx.db.patch(occurrence._id, {
        ...(revision !== undefined ? { revision } : {}),
        state: "cancelled",
        workActive: false,
        workGeneration: advanceEvent(occurrence.workGeneration),
        claimToken: undefined,
        leaseExpiresAt: undefined,
        headId: undefined,
        terminalAt: now,
        participationExpiresAt: now + 30 * EVENTS_DAY,
        historyExpiresAt: now + 180 * EVENTS_DAY,
    })
}
/** Stores new dates of an event under the next date numbers */
async function addOccurrences(
    ctx: MutationCtx,
    event: Doc<"events">,
    dates: readonly EventsResolvedDate[],
    state: "draft" | "open",
    revision: number,
    now: number,
) {
    const settings = await eventState(ctx, event.serverId)
    let next = settings.nextOccurrenceNo
    for (const date of dates)
        await ctx.db.insert("eventOccurrences", {
            serverId: event.serverId,
            eventNo: event.eventNo,
            occurrenceNo: next++,
            revision,
            date,
            state,
            participationStarted: false,
            capacity: event.capacity,
            going: 0,
            waitlisted: 0,
            rsvps: 0,
            nextQueueOrder: 1,
            workGeneration: 1,
            workActive: false,
            nextCheckAt: now,
        })
    await ctx.db.patch(settings._id, { nextOccurrenceNo: integer(next, 1, Number.MAX_SAFE_INTEGER) })
}
/**
 * Adds the next dates of a published event's repeat as earlier ones start, resolved here in its zone, and queues their
 * reminders. It runs again when the soonest open date starts or the horizon reaches the next date. The event's end follows the
 * last stored date, and it completes only once no date is left to add
 */
export async function extendEvent(ctx: MutationCtx, event: Doc<"events">, now: number) {
    const calendar = event.calendar
    if (event.state !== "open" || event.forgetting || !calendar) {
        await ctx.db.patch(event._id, { extendAt: undefined })
        return
    }
    const live = await ctx.db
        .query("eventOccurrences")
        .withIndex("by_event_state", (q) =>
            q.eq("serverId", event.serverId).eq("eventNo", event.eventNo).eq("state", "open").gt("date.startsAt", now),
        )
        .take(CIVIL_WINDOW)
    const window = materializeCivil(calendar, event.nextIndex ?? calendar.dates.length, live.length, now)
    const dates = window.dates.map((date) => ({
        localMinute: date.localMinute,
        startsAt: date.instantAt,
        endsAt: date.instantAt + calendar.durationMinutes * 60000,
        offsetMinutes: date.offsetMinutes,
    }))
    await addOccurrences(ctx, event, dates, "open", event.revision, now)
    const soonest = live[0]?.date.startsAt ?? dates[0]?.startsAt
    await ctx.db.patch(event._id, {
        nextIndex: window.next,
        extendAt: [soonest, window.nextAt].filter((at) => at !== undefined).sort((a, b) => a - b)[0],
        ...(dates.length ? { endsAt: Math.max(event.endsAt ?? 0, dates.at(-1)!.endsAt) } : {}),
        ...(window.skipped ? { lastSkipped: window.skipped } : {}),
    })
    if (dates.length) await queueEventReminders(ctx, (await ctx.db.get(event._id))!)
}
