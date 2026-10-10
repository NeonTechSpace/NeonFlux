import { configurationSourceId, type ConfigurationIdentity } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { v } from "convex/values"
import type { EventsDeliveryGrant, EventsManageResult, EventsQueryResult, EventsRsvpResult } from "../contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { administrator } from "./moderationDomain.ts"
import { publishingContent, publishingName, shape } from "./publishingDomain.ts"
import { reservePublishing, forgetConsumerPost } from "./publishing.ts"
import { advanceEvent, eventCapacity, eventOffsets, epochOrder, EVENTS_DAY, renderEvent, validateEventCalendar } from "./eventsDomain.ts"
import { eventCardChannel, eventCount, eventReceipt, eventRow, eventSettings, eventState, lifecycle, occurrenceRow, publicEvent, publicOccurrence, publicRsvp, wakePromotion } from "./eventsStore.ts"
import { eventGate } from "./schedulesStore.ts"
import { fail, object, requireId, requireServer, integer, name, source, text } from "./validation.ts"
import { eventAdmin, eventContext, eventEligible } from "./publishingContext.ts"

export async function invalidateEventDeliveries(ctx: MutationCtx, event: Doc<"events">) {
    const stale = await ctx.db.query("eventDeliveries").withIndex("by_event_unattempted", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo).eq("attemptId", undefined).lt("revision", event.revision)).take(53)
    for (const row of stale) await ctx.db.delete(row._id)
    const rows = []
    for (const state of ["queued", "blocked", "reserved"] as const) rows.push(...await ctx.db.query("eventDeliveries").withIndex("by_event_active", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo).eq("state", state).eq("claimedAt", undefined)).take(53))
    if (rows.length > 52) fail(503, "Event delivery accounting unavailable")
    for (const row of rows) {
        const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (attempt?.dispatchedAt !== undefined || !["queued", "blocked", "reserved"].includes(row.state)) continue
        if (attempt?.outcome === "pending") {
            await ctx.db.patch(attempt._id, { outcome: "failed", unresolved: false, noDispatch: true, finishedAt: Date.now(), expiresAt: Date.now() + 180 * EVENTS_DAY })
            const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", row.serverId).eq("postNo", row.postNo!)).unique()
            if (post?.attemptId === attempt._id) await ctx.db.patch(post._id, { outcome: "failed", updatedAt: Date.now() })
        }
        await ctx.db.patch(row._id, { state: "cancelled" })
    }
}
export async function queueEventReminders(ctx: MutationCtx, event: Doc<"events">) {
    const occurrences = await ctx.db.query("eventOccurrences").withIndex("by_event", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo)).take(27)
    for (const occurrence of occurrences) for (const offsetMinutes of event.reminderOffsets) {
        const dueAt = occurrence.date.startsAt - offsetMinutes * 60000
        if (dueAt < Date.now() || lifecycle({ ...occurrence.date, state: occurrence.state }) !== "open") continue
        if (await ctx.db.query("eventDeliveries").withIndex("by_binding", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo).eq("occurrenceNo", occurrence.occurrenceNo).eq("revision", event.revision).eq("offsetMinutes", offsetMinutes)).first()) continue
        await ctx.db.insert("eventDeliveries", { serverId: event.serverId, eventNo: event.eventNo, occurrenceNo: occurrence.occurrenceNo, revision: event.revision, channelId: event.channelId, offsetMinutes, dueAt, startsAt: occurrence.date.startsAt, state: "queued", nextCheckAt: dueAt, createdAt: Date.now() })
    }
}
async function eventCard(ctx: MutationCtx, event: Doc<"events">, identity: ConfigurationIdentity, context: ReturnType<typeof eventContext>) {
    if (!context.botAuthorized || !context.actorAuthorized || context.channelId !== event.channelId) fail(403, "Invoker and destination permissions required")
    const existing = event.cardPostNo !== undefined ? await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", event.serverId).eq("postNo", event.cardPostNo!)).unique() : null
    if (event.cardPostNo !== undefined && !existing) fail(503, "Event card unavailable")
    await eventEligible(ctx, event.serverId, context, event.channelId, context.actor.userId)
    const reserved = await reservePublishing(ctx, { serverId: event.serverId, sourceId: configurationSourceId(identity), actorId: context.actor.userId, botId: context.botId, channelId: eventCardChannel(event),
        // In a forum or media channel the card becomes the first message of its own post
        forumPostName: event.title, source: identity.source.kind === "chat" ? { type: "human", messageId: identity.source.messageId, createdAt: identity.createdAt } : { type: "dashboard-configuration", jobId: identity.source.jobId, family: "events", createdAt: identity.createdAt }, provenance: { type: "event", eventNo: event.eventNo, revision: event.revision, ...(event.template ? { template: { name: event.template.name, revision: event.template.revision } } : {}) },
        consumer: { type: "event", eventNo: event.eventNo, revision: event.revision, purpose: "card" }, content: renderEvent(event), ...(existing ? { existing } : {}) })
    await ctx.db.patch(event._id, { cardPostNo: reserved.post.postNo })
    return reserved.grant as EventsDeliveryGrant
}
async function forgetEvent(ctx: MutationCtx, event: Doc<"events">) {
    if (publicEvent(event).state !== "cancelled" && publicEvent(event).state !== "completed" && event.state !== "draft") fail(409, "Cancel event before forgetting")
    if (await ctx.db.query("publishingAttempts").withIndex("by_event_unresolved", q => q.eq("serverId", event.serverId).eq("consumer.eventNo", event.eventNo).eq("unresolved", true)).first()) fail(409, "Unresolved event publication preserved")
    const posts = await ctx.db.query("publishingPosts").withIndex("by_event", q => q.eq("serverId", event.serverId).eq("consumer.eventNo", event.eventNo)).take(21)
    await ctx.db.patch(event._id, { forgetting: true })
    let removed = 0
    for (const post of posts.slice(0, 20)) {
        await forgetConsumerPost(ctx, post)
        if (post.postNo === event.cardPostNo) await ctx.db.patch(event._id, { cardPostNo: undefined })
        removed++
    }
    if (posts.length > 20) return { complete: false, removed }
    const occurrences = await ctx.db.query("eventOccurrences").withIndex("by_event", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo)).take(27)
    for (const occurrence of occurrences) {
        const remaining = 20 - removed
        const rows = await ctx.db.query("eventRsvps").withIndex("by_occurrence", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo).eq("occurrenceNo", occurrence.occurrenceNo)).take(remaining + 1)
        for (const row of rows.slice(0, remaining)) { await ctx.db.delete(row._id); await eventCount(ctx, event.serverId, "rsvps", -1); removed++ }
        if (rows.length > remaining) return { complete: false, removed }
        if (removed >= 20) return { complete: false, removed }
        await ctx.db.delete(occurrence._id); await eventCount(ctx, event.serverId, "occurrences", -1); removed++
    }
    const deliveries = await ctx.db.query("eventDeliveries").withIndex("by_event", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo)).take(21)
    for (const delivery of deliveries.slice(0, 20 - removed)) { await ctx.db.delete(delivery._id); removed++ }
    if (await ctx.db.query("eventDeliveries").withIndex("by_event", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo)).first()) return { complete: false, removed }
    await ctx.db.delete(event._id); await eventCount(ctx, event.serverId, "definitions", -1)
    return { complete: true, removed: removed + 1 }
}
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<EventsManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "context", "operation"], ["serverId", "messageId", "createdAt", "context", "operation"]), now = Date.now(), identity = source(input, now), context = eventContext(input.context), op = object(input.operation)
    await eventAdmin(ctx, identity.serverId, context, op.type === "cancel" || op.type === "forget" || op.type === "reconcile" || op.type === "settings" && op.enabled === false)
    if (!await eventReceipt(ctx, identity, context.actor.userId, op)) return { duplicate: true }
    const apply = () => applyEventsManagement(ctx, { serverId: identity.serverId, actorId: context.actor.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, context, op, now)
    if (op.type === "reconcile") return apply()
    return changeConfiguration(ctx, identity.serverId, "events", { kind: "chat", createdAt: identity.createdAt, actor: { userId: context.actor.userId, source: "command" }, operation: op }, apply)
} })

export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<EventsQueryResult> => {
    const input = shape(request, ["serverId", "context", "operation"], ["serverId", "context", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const context = eventContext(input.context), op = object(input.operation), state = await eventSettings(ctx, serverId), settings = { enabled: state?.enabled ?? false, revision: state?.revision ?? 1, threads: state?.threads ?? false }
    const admin = administrator(context.actor)
    if (op.type === "settings" || op.type === "status") {
        shape(op, ["type"], ["type"]); await eventAdmin(ctx, serverId, context, true)
        return op.type === "settings" ? { type: "settings", settings } : { type: "status", settings, definitions: state?.definitions ?? 0, occurrences: state?.occurrences ?? 0, rsvps: state?.rsvps ?? 0, receipts: state?.receipts ?? 0 }
    }
    if (!admin && (!settings.enabled || !context.member || context.member.userId !== context.actor.userId)) fail(403, "Event discovery unavailable")
    await eventGate(ctx, serverId, admin)
    if (op.type === "list") {
        shape(op, ["type", "beforeEventNo"], ["type"])
        if (!admin) await eventEligible(ctx, serverId, context, context.channelId, context.actor.userId)
        const before = op.beforeEventNo === undefined ? Number.MAX_SAFE_INTEGER : integer(op.beforeEventNo, 1, Number.MAX_SAFE_INTEGER)
        const rows = await ctx.db.query("events").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", context.channelId).lt("eventNo", before)).order("desc").take(51)
        const visible = rows.filter(r => !r.forgetting && (admin || r.state !== "draft")), selected = visible.slice(0, 10)
        return { type: "events", events: selected.map(publicEvent), ...(visible.length > 10 ? { nextBeforeEventNo: selected.at(-1)!.eventNo } : {}) }
    }
    // Chat commands name an event, which is unique in a server through the by_name index
    const byName = op.type === "show" && op.name !== undefined
    if (op.type === "show") shape(op, ["type", byName ? "name" : "eventNo"], ["type", byName ? "name" : "eventNo"])
    const event = byName ? await ctx.db.query("events").withIndex("by_name", q => q.eq("serverId", serverId).eq("name", name(op.name))).unique() ?? fail(404, "Event not found") : await eventRow(ctx, serverId, op.eventNo)
    if (!admin) { if (event.state === "draft" || event.forgetting) fail(403, "Event unavailable"); await eventEligible(ctx, serverId, context, event.channelId, context.actor.userId) }
    if (op.type === "show") return { type: "event", event: publicEvent(event) }
    if (op.type === "dates") {
        shape(op, ["type", "eventNo", "afterOccurrenceNo"], ["type", "eventNo"])
        const after = op.afterOccurrenceNo === undefined ? 0 : integer(op.afterOccurrenceNo, 0, Number.MAX_SAFE_INTEGER)
        const rows = await ctx.db.query("eventOccurrences").withIndex("by_number", q => q.eq("serverId", serverId).eq("eventNo", event.eventNo).gt("occurrenceNo", after)).take(11), selected = rows.slice(0, 10)
        return { type: "dates", dates: selected.map(publicOccurrence), ...(rows.length > 10 ? { nextAfterOccurrenceNo: selected.at(-1)!.occurrenceNo } : {}) }
    }
    if (op.type === "attendees") {
        shape(op, ["type", "eventNo", "occurrenceNo", "afterUserId"], ["type", "eventNo", "occurrenceNo"])
        if (context.channelId !== event.channelId) fail(403, "Attendees stay in event destination")
        const occurrence = await occurrenceRow(ctx, serverId, event.eventNo, op.occurrenceNo), after = op.afterUserId === undefined ? "" : requireId(op.afterUserId)
        const rows = await ctx.db.query("eventRsvps").withIndex("by_occurrence", q => q.eq("serverId", serverId).eq("eventNo", event.eventNo).eq("occurrenceNo", occurrence.occurrenceNo).gt("userId", after)).take(21), selected = rows.slice(0, 20)
        return { type: "attendees", attendees: selected.map(publicRsvp), ...(rows.length > 20 ? { nextAfterUserId: selected.at(-1)!.userId } : {}) }
    }
    fail(400, "Invalid event query")
} })

export const rsvp = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<EventsRsvpResult> => {
    const keys = ["serverId", "messageId", "createdAt", "context", "eventNo", "occurrenceNo", "choice"]
    const input = shape(request, keys, keys), identity = source(input, Date.now()), context = eventContext(input.context)
    const event = await eventRow(ctx, identity.serverId, input.eventNo), occurrence = await occurrenceRow(ctx, identity.serverId, event.eventNo, input.occurrenceNo)
    if (!(await eventSettings(ctx, event.serverId))?.enabled || event.forgetting || lifecycle({ state: occurrence.state, ...occurrence.date }) !== "open") fail(403, "RSVP closed")
    const member = await eventEligible(ctx, event.serverId, context, event.channelId, context.actor.userId)
    if (!["going", "maybe", "not-going", "none"].includes(String(input.choice))) fail(400, "Invalid RSVP choice")
    const old = await ctx.db.query("eventRsvps").withIndex("by_occurrence", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo).eq("occurrenceNo", occurrence.occurrenceNo).eq("userId", member.userId)).unique()
    const response = async (accepted: boolean, duplicate = false): Promise<EventsRsvpResult> => {
        const current = await ctx.db.query("eventRsvps").withIndex("by_occurrence", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo).eq("occurrenceNo", occurrence.occurrenceNo).eq("userId", member.userId)).unique()
        return { duplicate, accepted, rsvp: current ? publicRsvp(current) : null, occurrence: publicOccurrence((await ctx.db.get(occurrence._id))!) }
    }
    const receiptBinding = { eventNo: event.eventNo, occurrenceNo: occurrence.occurrenceNo, choice: input.choice, joinedAt: member.joinedAt }
    if (!await eventReceipt(ctx, identity, member.userId, receiptBinding)) return response(false, true)
    if (identity.createdAt < Date.parse(member.joinedAt) || identity.createdAt < (event.activatedAt ?? Infinity)) fail(409, "RSVP predates membership or activation")
    // Source message order decides between competing RSVP writes from the same membership
    const olderEpoch = old && (epochOrder(member.joinedAt) < epochOrder(old.joinedAt) || member.joinedAt !== old.joinedAt && epochOrder(member.joinedAt) === epochOrder(old.joinedAt))
    const olderSource = old && (identity.createdAt < old.acceptedCreatedAt
        || identity.createdAt === old.acceptedCreatedAt && BigInt(identity.messageId) <= BigInt(old.acceptedMessageId))
    if (olderEpoch || olderSource) return response(false)
    if (old && context.observedAt < old.observedAt) return response(false)
    if (!old && occurrence.rsvps >= 1000) fail(429, "Occurrence participation capacity reached")
    const sameEpoch = old?.joinedAt === member.joinedAt, choice = input.choice as Doc<"eventRsvps">["choice"], keepsGoing = sameEpoch && old.choice === "going" && choice === "going"
    const going = occurrence.going - (old?.allocation === "seat" && !keepsGoing ? 1 : 0), waitlisted = occurrence.waitlisted - (old?.allocation === "waitlist" && !keepsGoing ? 1 : 0)
    const allocation = keepsGoing ? old.allocation : choice === "going" ? waitlisted === 0 && (occurrence.capacity === null || going < occurrence.capacity) ? "seat" : "waitlist" : "none"
    const fields = { joinedAt: member.joinedAt, membershipGeneration: sameEpoch ? old.membershipGeneration : (old?.membershipGeneration ?? 0) + 1, revision: (old?.revision ?? 0) + 1, choice, allocation, queueOrder: keepsGoing ? old.queueOrder : allocation === "waitlist" ? occurrence.nextQueueOrder : undefined, deferredUntil: undefined, acceptedCreatedAt: identity.createdAt, acceptedMessageId: identity.messageId, observedAt: context.observedAt }
    if (old) await ctx.db.patch(old._id, fields)
    else {
        await eventCount(ctx, event.serverId, "rsvps", 1)
        const { deferredUntil, queueOrder, ...required } = fields
        await ctx.db.insert("eventRsvps", { serverId: event.serverId, eventNo: event.eventNo, occurrenceNo: occurrence.occurrenceNo, userId: member.userId, createdAt: Date.now(), ...required, ...(queueOrder !== undefined ? { queueOrder } : {}) })
    }
    await ctx.db.patch(occurrence._id, { participationStarted: true, rsvps: occurrence.rsvps + (old ? 0 : 1), nextQueueOrder: occurrence.nextQueueOrder + (!keepsGoing && allocation === "waitlist" ? 1 : 0) })
    await ctx.db.patch(event._id, { participationStarted: true })
    await wakePromotion(ctx, (await ctx.db.get(occurrence._id))!, { going: going + (!keepsGoing && allocation === "seat" ? 1 : 0), waitlisted: waitlisted + (!keepsGoing && allocation === "waitlist" ? 1 : 0) })
    return response(true)
} })

export async function applyEventsManagement(ctx: MutationCtx, identity: ConfigurationIdentity, context: ReturnType<typeof eventContext> | undefined, op: Record<string, unknown>, now: number): Promise<EventsManageResult> {
    const state = await eventState(ctx, identity.serverId)
    if (op.type === "settings" || op.type === "threads") {
        shape(op, ["type", "expectedRevision", "enabled"], ["type", "expectedRevision", "enabled"])
        if (state.revision !== integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Event settings changed")
        if (typeof op.enabled !== "boolean") fail(400, "Invalid event settings")
        if (op.type === "settings" && op.enabled && await ctx.db.query("responseDefinitions").withIndex("by_server_kind_name", q => q.eq("serverId", identity.serverId).eq("kind", "custom").eq("name", "event")).first()) fail(409, "Event command namespace occupied")
        // Discussion threads apply to events published while they are on
        await ctx.db.patch(state._id, { [op.type === "settings" ? "enabled" : "threads"]: op.enabled, revision: advanceEvent(state.revision) })
        const next = (await ctx.db.get(state._id))!
        return { duplicate: false, type: "settings", settings: { enabled: next.enabled, revision: next.revision, threads: next.threads ?? false } }
    }
    if (op.type === "create") {
        if (!context) fail(403, "Native administrator required")
        shape(op, ["type", "name", "title", "description", "channelId"], ["type", "name", "title", "channelId"])
        const eventName = name(op.name), channelId = requireId(op.channelId)
        if (await ctx.db.query("events").withIndex("by_name", q => q.eq("serverId", identity.serverId).eq("name", eventName)).unique()) fail(409, "Event name already exists")
        const description = op.description === undefined || op.description === "" ? "" : text(op.description, 3500)
        await eventCount(ctx, identity.serverId, "definitions", 1)
        const id = await ctx.db.insert("events", { serverId: identity.serverId, eventNo: state.nextEventNo, name: eventName, revision: 1, channelId, title: text(op.title, 256), description, capacity: null, reminderOffsets: [1440, 60], state: "draft", participationStarted: false, createdAt: now, updatedAt: now })
        await ctx.db.patch(state._id, { nextEventNo: advanceEvent(state.nextEventNo) })
        return { duplicate: false, type: "event", event: publicEvent((await ctx.db.get(id))!) }
    }
    const event = await eventRow(ctx, identity.serverId, op.eventNo, op.expectedRevision)
    if (op.type === "forget") {
        shape(op, ["type", "eventNo", "expectedRevision", "confirm"], ["type", "eventNo", "expectedRevision", "confirm"])
        if (op.confirm !== "forget") fail(400, "Explicit forgetting confirmation required")
        return { duplicate: false, type: "forgotten", eventNo: event.eventNo, ...await forgetEvent(ctx, event) }
    }
    if (op.type === "reconcile") {
        shape(op, ["type", "eventNo", "expectedRevision"], ["type", "eventNo", "expectedRevision"])
        return { duplicate: false, type: "event", event: publicEvent(event) }
    }
    if (event.forgetting || event.state === "cancelled" || publicEvent(event).state === "completed") fail(409, "Event is closed")
    const occurrences = await ctx.db.query("eventOccurrences").withIndex("by_event", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo)).take(27)
    if (op.type === "publish") {
        shape(op, ["type", "eventNo", "expectedRevision"], ["type", "eventNo", "expectedRevision"])
        if (!state.enabled) fail(403, "Events disabled")
        if (event.state !== "draft" || !event.calendar || event.calendar.dates.some(d => d.startsAt <= now)) fail(409, "Future draft calendar required")
        if (!context) fail(403, "Native administrator required")
        const grant = await eventCard(ctx, event, identity, context)
        await ctx.db.patch(event._id, { state: "open", activatedAt: now, updatedAt: now })
        for (const occurrence of occurrences) await ctx.db.patch(occurrence._id, { state: "open" })
        await queueEventReminders(ctx, (await ctx.db.get(event._id))!)
        return { duplicate: false, type: "event", event: publicEvent((await ctx.db.get(event._id))!), grant }
    }
    if (op.type === "cancel") {
        shape(op, ["type", "eventNo", "expectedRevision"], ["type", "eventNo", "expectedRevision"])
        await invalidateEventDeliveries(ctx, event)
        for (const occurrence of occurrences) await ctx.db.patch(occurrence._id, { state: "cancelled", workActive: false, workGeneration: advanceEvent(occurrence.workGeneration), claimToken: undefined, leaseExpiresAt: undefined, headId: undefined, terminalAt: now, participationExpiresAt: now + 30 * EVENTS_DAY })
        // Close only an unclaimed card, preserving already dispatched provider outcomes
        if (event.cardPostNo !== undefined) {
            const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", event.serverId).eq("postNo", event.cardPostNo!)).unique(), attempt = post?.attemptId ? await ctx.db.get(post.attemptId) : null
            if (post && attempt?.outcome === "pending" && attempt.dispatchedAt === undefined) { await ctx.db.patch(attempt._id, { outcome: "failed", unresolved: false, noDispatch: true, finishedAt: now, expiresAt: now + 180 * EVENTS_DAY }); await ctx.db.patch(post._id, { outcome: "failed", updatedAt: now }) }
        }
        await ctx.db.patch(event._id, { state: "cancelled", revision: advanceEvent(event.revision), updatedAt: now, terminalAt: now, historyExpiresAt: now + 180 * EVENTS_DAY,
            // A discussion thread or forum post closes now, and one not yet started never starts
            threadDueAt: event.postId || event.threadId ? now : undefined })
        return { duplicate: false, type: "event", event: publicEvent((await ctx.db.get(event._id))!) }
    }
    const patch: Partial<Omit<Doc<"events">, "_id" | "_creationTime" | "template">> & { template?: Doc<"events">["template"] | undefined } = { revision: advanceEvent(event.revision), updatedAt: now }
    if (op.type === "calendar") {
        shape(op, ["type", "eventNo", "expectedRevision", "calendar"], ["type", "eventNo", "expectedRevision", "calendar"])
        if (event.participationStarted || occurrences.some(o => o.participationStarted || o.date.startsAt <= now)) fail(409, "Participating or past calendar is immutable")
        const calendar = validateEventCalendar(op.calendar, now)
        await eventCount(ctx, event.serverId, "occurrences", calendar.dates.length - occurrences.length)
        for (const occurrence of occurrences) await ctx.db.delete(occurrence._id)
        let next = state.nextOccurrenceNo
        for (const date of calendar.dates) await ctx.db.insert("eventOccurrences", { serverId: event.serverId, eventNo: event.eventNo, occurrenceNo: next++, revision: patch.revision!, date, state: event.state === "draft" ? "draft" : "open", participationStarted: false, capacity: event.capacity, going: 0, waitlisted: 0, rsvps: 0, nextQueueOrder: 1, workGeneration: 1, workActive: false, nextCheckAt: now })
        await ctx.db.patch(state._id, { nextOccurrenceNo: integer(next, 1, Number.MAX_SAFE_INTEGER) })
        patch.calendar = calendar
        patch.endsAt = calendar.dates.at(-1)!.endsAt
    } else if (op.type === "destination") {
        shape(op, ["type", "eventNo", "expectedRevision", "channelId"], ["type", "eventNo", "expectedRevision", "channelId"])
        if (event.state !== "draft" || event.participationStarted || event.cardPostNo !== undefined) fail(409, "Published event destination is immutable")
        patch.channelId = requireId(op.channelId)
        if (!context) fail(403, "Native administrator required")
        await eventEligible(ctx, event.serverId, context, patch.channelId, context.actor.userId)
    } else if (op.type === "content") {
        shape(op, ["type", "eventNo", "expectedRevision", "title", "description"], ["type", "eventNo", "expectedRevision", "title", "description"])
        patch.title = text(op.title, 256); patch.description = op.description === "" ? "" : text(op.description, 3500)
    } else if (op.type === "capacity") {
        shape(op, ["type", "eventNo", "expectedRevision", "capacity"], ["type", "eventNo", "expectedRevision", "capacity"])
        patch.capacity = eventCapacity(op.capacity)
        if (patch.capacity !== null && occurrences.some(o => o.going > patch.capacity!)) fail(409, "Capacity below confirmed attendance")
    } else if (op.type === "reminders") {
        shape(op, ["type", "eventNo", "expectedRevision", "offsets"], ["type", "eventNo", "expectedRevision", "offsets"]); patch.reminderOffsets = eventOffsets(op.offsets)
    } else if (op.type === "template") {
        shape(op, ["type", "eventNo", "expectedRevision", "templateName", "expectedTemplateRevision"], ["type", "eventNo", "expectedRevision", "templateName"])
        if (op.templateName === null) patch.template = undefined
        else {
            const template = await ctx.db.query("publishingDrafts").withIndex("by_server_kind_name", q => q.eq("serverId", event.serverId).eq("kind", "template").eq("name", publishingName(op.templateName))).unique()
            if (!template) fail(404, "Template not found")
            if (template.revision !== integer(op.expectedTemplateRevision, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Template revision changed")
            patch.template = { name: template.name, revision: template.revision, content: publishingContent(template.content) }
        }
    } else fail(400, "Invalid event operation")
    await invalidateEventDeliveries(ctx, event)
    if (event.cardPostNo !== undefined) {
        const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", event.serverId).eq("postNo", event.cardPostNo!)).unique(), attempt = post?.attemptId ? await ctx.db.get(post.attemptId) : null
        if (post && attempt?.outcome === "pending" && attempt.dispatchedAt === undefined) {
            await ctx.db.patch(attempt._id, { outcome: "failed", unresolved: false, noDispatch: true, finishedAt: now, expiresAt: now + 180 * EVENTS_DAY })
            await ctx.db.patch(post._id, { outcome: "failed", updatedAt: now })
        }
    }
    await ctx.db.patch(event._id, patch)
    if (op.type !== "calendar") for (const occurrence of occurrences) {
        await ctx.db.patch(occurrence._id, { revision: patch.revision! })
        await wakePromotion(ctx, (await ctx.db.get(occurrence._id))!, { ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}) })
    }
    const next = (await ctx.db.get(event._id))!
    let grant: EventsDeliveryGrant | undefined
    if (next.calendar) renderEvent(next)
    if (next.cardPostNo !== undefined) { if (!context) fail(403, "Native administrator required"); grant = await eventCard(ctx, next, identity, context) }
    if (next.state !== "draft") await queueEventReminders(ctx, next)
    return { duplicate: false, type: "event", event: publicEvent((await ctx.db.get(event._id))!), ...(grant ? { grant } : {}) }
}
