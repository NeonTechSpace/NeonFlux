import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { eventHelp, eventPublic, type EventCommand } from "./event-command.ts"
import { createEventCalendar, EventCalendarError, resolvedEventDateText } from "./event-calendar.ts"
import { eventDetail, eventAttendeeText, renderEventContent } from "./event-render.ts"
import { EventsStoreError, eventsErrorMessage, type EventsStore } from "./event-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { performPublishingGrant } from "./publishing.ts"
import { canonicalPublishingContent, equalPublishingContent } from "./publishing-content.ts"
import { publishingMessageContent } from "./publishing-content.ts"
import { EventsPermissionError, readEventsContext, readPublishingAuthority, verifyPublishingMessage } from "./publishing-permissions.ts"
import { moderationActor } from "./moderation.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { readCommandChannel } from "./fluxerly-next.ts"

export class EventsHandlingError extends Data.TaggedError("EventsHandlingError")<{ readonly stage: "response" | "grant" | "calendar" }> {}
export function handleEventCommand(store: EventsStore, publishing: PublishingStore | undefined, config: BotConfig, command: EventCommand | { error: string },
    context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => Effect.gen(function* () { for (let i = 0; i < content.length; i += 1900) yield* context.reply({ content: content.slice(i, i + 1900), allowedMentions: noMentions }) })
    return Effect.gen(function* () {
        if (context.message.guildId !== config.serverId) return
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(withPrefix(eventHelp(), prefix)); return }
        const { client, message } = context
        // A command in any post of a forum destination counts as in the forum
        const here = yield* readCommandChannel(client, message.channelId)
        const fresh = () => readEventsContext(client, config.serverId, message.author.id, here, { staff: !eventPublic(command), forum: "forum" }).pipe(Effect.flatMap(value =>
            eventPublic(command) && (!value.member?.canView || !value.member.canReadHistory || !value.botAuthorized
                || value.member.timeoutUntil !== null && Date.parse(value.member.timeoutUntil) > value.observedAt)
                ? Effect.fail(new EventsPermissionError({ stage: "member" })) : Effect.succeed(value)))
        const query = (operation: C.EventsQueryRequest["operation"]) => fresh().pipe(Effect.flatMap(context => store.query({ serverId: config.serverId, context, operation })))
        if (command.type === "query") {
            const result = yield* query(command.operation)
            if (result.type === "event") {
                if (result.event.channelId !== here) return yield* Effect.fail(new EventsPermissionError({ stage: "destination" }))
                yield* reply(eventDetail(result.event, prefix))
            }
            else if (result.type === "events") yield* reply([...result.events.map(e => `Event ${e.eventNo}: ${e.title}, ${e.state}, revision ${e.revision}. ${prefix}event show ${e.eventNo}`),
                ...(result.events.length ? [] : ["No events in this destination"]), ...(result.nextBeforeEventNo ? [`Next: ${prefix}event list ${result.nextBeforeEventNo}`] : [])].join("\n"))
            else if (result.type === "dates") {
                const found = yield* query({ type: "show", eventNo: command.operation.type === "dates" ? command.operation.eventNo : 0 })
                if (found.type !== "event" || !found.event.calendar) return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
                if (found.event.channelId !== here || result.dates.some(d => d.revision !== found.event.revision
                    || !found.event.calendar!.dates.some(c => c.startsAt === d.startsAt && c.endsAt === d.endsAt && c.localMinute === d.localMinute && c.offsetMinutes === d.offsetMinutes))) return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
                yield* reply([...result.dates.map(d => `Occurrence ${d.occurrenceNo}, revision ${d.revision}, ${d.state}: ${d.going} Going, ${d.waitlisted} waiting\n${resolvedEventDateText(d, found.event.calendar!.zone)}`),
                    ...(result.nextAfterOccurrenceNo ? [`Next: ${prefix}event dates ${found.event.eventNo} ${result.nextAfterOccurrenceNo}`] : [])].join("\n"))
            } else if (result.type === "attendees") yield* reply([...result.attendees.map(a => eventAttendeeText(a, message.author.id)), ...(result.attendees.length ? [] : ["No recorded attendance"]),
                ...(result.nextAfterUserId && command.operation.type === "attendees" ? [`Next: ${prefix}event attendees ${command.operation.eventNo} ${command.operation.occurrenceNo} ${result.nextAfterUserId}`] : [])].join("\n"))
            else yield* reply(`Events ${result.settings.enabled ? "On" : "Off"}, discussion threads ${result.settings.threads ? "On" : "Off"}, settings revision ${result.settings.revision}${result.type === "status" ? `, ${result.definitions}/50 definitions, ${result.occurrences}/200 occurrences, ${result.rsvps}/50000 RSVP records` : ""}`)
            return
        }
        if (command.type === "delivery-status") {
            yield* fresh()
            let afterDeliveryId: string | undefined
            let result: C.EventsDeliveryResult = { type: "deliveries", deliveries: [] }
            for (let page = 1; page <= command.page; page++) {
                result = yield* store.delivery({ serverId: config.serverId, operation: { type: "status", eventNo: command.eventNo, ...(afterDeliveryId ? { afterDeliveryId } : {}) } })
                if (result.type !== "deliveries") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
                if (page < command.page && !result.nextAfterDeliveryId) { yield* reply(`That retained delivery page is unavailable. Start with ${prefix}event status and the event number`); return }
                afterDeliveryId = result.nextAfterDeliveryId
            }
            if (result.type !== "deliveries") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            const found = yield* query({ type: "show", eventNo: command.eventNo })
            if (found.type !== "event") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            yield* reply([eventDetail(found.event, prefix), `Delivery page ${command.page}`, ...result.deliveries.map(d => `Occurrence ${d.occurrenceNo}, ${d.offsetMinutes}-minute reminder: ${d.state}, due ${new Date(d.dueAt).toISOString()}${d.postNo ? `, tracked post ${d.postNo}. Reconcile: ${prefix}event reconcile ${command.eventNo} ${found.event.revision} ${d.postNo}` : ""}`),
                ...(result.nextAfterDeliveryId && command.page < 26 ? [`Next: ${prefix}event status ${command.eventNo} ${command.page + 1}`] : [])].join("\n"))
            return
        }
        if (command.type === "forget" && !command.confirmed) { yield* fresh(); yield* reply(`Forgetting removes settled stored event participation and publishing tracking in bounded pages. Native messages stay\nConfirm: ${prefix}event forget ${command.eventNo} ${command.revision} confirm`); return }
        const createdAt = yield* sourceTimestamp(message)
        if (command.type === "reconcile") {
            const found = yield* query({ type: "show", eventNo: command.eventNo })
            if (found.type !== "event" || found.event.revision !== command.revision) return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            const postNo = command.postNo ?? found.event.cardPostNo
            if (!publishing || !postNo) { yield* reply(`There is no managed card to reconcile. Inspect ${prefix}event status and select an exact retained reminder post number`); return }
            const permission = yield* fresh()
            const tracked = yield* publishing.query({ serverId: config.serverId, actor: permission.actor, operation: { type: "post-show", postNo } })
            if (tracked.type !== "post" || tracked.post.consumer?.type !== "event" || tracked.post.consumer.eventNo !== command.eventNo) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
            const post = tracked.post
            if (!post.messageId) { yield* reply(`Post ${post.postNo} has no known native message identity. Reconciliation cannot search for, adopt or resend a message`); return }
            const authority = yield* readPublishingAuthority(client, config.serverId, message.author.id, post.channelId, false, true, false, "post")
            if (authority.botId !== post.botId) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
            const native = yield* client.messages.fetch({ channelId: post.channelId, id: post.messageId }, { timeoutMs: 5000 })
            yield* verifyPublishingMessage(native, { serverId: config.serverId, channelId: post.channelId, messageId: post.messageId, botId: post.botId, verifiedChannel: authority.channel! })
            const content = publishingMessageContent(native)
            if (!content) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
            const result = yield* publishing.reconcile({ serverId: config.serverId, actor: moderationActor(authority), messageId: message.id, createdAt, postNo,
                attemptId: post.attempt.attemptId, expectedGeneration: post.generation, observation: { originServerId: config.serverId, observedAt: yield* Clock.currentTimeMillis, messageId: native.id, channelId: native.channelId, botId: native.author.id, content } })
            yield* reply(`Event ${command.eventNo}, post ${postNo}: ${result.recorded ? "Observation recorded" : "Observation already current"}, outcome ${result.post.outcome}${result.post.attempt.resolution ? ", current tracking baseline resolved" : ""}. Original delivery outcome is retained. No message was sent, edited or deleted`)
            return
        }
        if (command.type === "rsvp") {
            const result = yield* store.rsvp({ serverId: config.serverId, context: yield* fresh(), messageId: message.id, createdAt,
                eventNo: command.eventNo, occurrenceNo: command.occurrenceNo, choice: command.choice })
            if (worker) yield* worker.notify()
            yield* reply(`${result.duplicate ? "Already recorded" : result.accepted ? "RSVP recorded" : "RSVP was not accepted"}. Occurrence ${result.occurrence.occurrenceNo}${result.rsvp ? `\n${eventAttendeeText(result.rsvp, message.author.id)}` : ""}`)
            return
        }
        let operation: C.EventsManageOperation
        let destination = here
        let cardExists = false
        if (command.type === "create") { operation = { ...command }; destination = command.channelId }
        else if (command.type === "manage") operation = command.operation
        else if (command.type === "forget") operation = { type: "forget", eventNo: command.eventNo, expectedRevision: command.revision, confirm: "forget" }
        else {
            const found = yield* query({ type: "show", eventNo: command.eventNo })
            if (found.type !== "event" || found.event.revision !== command.revision) return yield* Effect.fail(new EventsHandlingError({ stage: "calendar" }))
            const current = found.event.calendar
            if (command.type === "repeat" && !current) { yield* reply(`Set ${prefix}event time before choosing repeat`); return }
            const calendar = command.type === "time" ? createEventCalendar(command.localMinute, command.zone, command.durationMinutes, command.fold, current?.recurrence)
                : createEventCalendar(current!.localMinute, current!.zone, current!.durationMinutes, current!.fold, command.recurrence)
            const now = yield* Clock.currentTimeMillis
            if (calendar.dates[0]!.startsAt <= now || calendar.dates.at(-1)!.startsAt > now + 180 * 86400000) { yield* reply("Every occurrence must start in the future within 180 days. Choose a shorter finite calendar"); return }
            operation = { type: "calendar", eventNo: command.eventNo, expectedRevision: command.revision, calendar }
        }
        if (operation.type !== "create" && operation.type !== "settings" && operation.type !== "threads") {
            const found = yield* query({ type: "show", eventNo: operation.eventNo })
            if (found.type !== "event") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            destination = found.event.channelId
            cardExists = found.event.cardPostNo !== undefined
        }
        const isWrite = operation.type === "publish" || cardExists && !["settings", "cancel", "forget", "reconcile"].includes(operation.type)
        if (!isWrite && operation.type !== "create") destination = here
        const result = yield* store.manage({ serverId: config.serverId, messageId: message.id, createdAt,
            context: yield* readEventsContext(client, config.serverId, message.author.id, destination, { staff: true, write: isWrite, hasEmbed: true, forum: "forum" }), operation })
        if (result.duplicate) { yield* reply("This event command was already recorded. Read current event and delivery status before another change"); return }
        if (worker) yield* worker.notify()
        if (result.type === "settings") yield* reply(`Events ${result.settings.enabled ? "On" : "Off"}, discussion threads ${result.settings.threads ? "On" : "Off"}, settings revision ${result.settings.revision}. Disable preserves data. Overdue reminders skip on resume`)
        else if (result.type === "forgotten") yield* reply(`Event ${result.eventNo}: ${result.removed} retained records removed, forgetting ${result.complete ? "Complete" : `Incomplete. Continue ${prefix}event forget ${result.eventNo} ${"expectedRevision" in operation ? operation.expectedRevision : 0} confirm with a new message`}. Native messages stay`)
        else {
            if (result.grant) {
                if (!publishing) { yield* reply(`Event ${result.event.eventNo} saved with reserved publishing work. Publishing transport is unavailable. Inspect status and reconcile. No replay`); return }
                const expected = renderEventContent(result.event)
                if (!equalPublishingContent(expected, result.grant.content) || !equalPublishingContent(canonicalPublishingContent(expected), result.grant.canonicalContent)) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
                const outcome = yield* performPublishingGrant(publishing, config.serverId, result.grant.actorId, client, result.grant,
                    () => readEventsContext(client, config.serverId, result.grant!.actorId, result.grant!.channelId, { staff: true, write: true, hasEmbed: !!result.grant!.content.embed, forum: "post" }))
                yield* reply(`Event ${result.event.eventNo} card: ${outcome.outcome}${outcome.acknowledged ? "" : ", outcome acknowledgement unconfirmed"}. ${prefix}event status ${result.event.eventNo}. No automatic replay`)
            }
            yield* reply(eventDetail(result.event, prefix))
        }
    }).pipe(Effect.catch(error => reply(error instanceof EventsStoreError ? withPrefix(eventsErrorMessage(error), prefix) : error instanceof EventCalendarError ? error.message
        : error instanceof EventsPermissionError && error.stage === "administrator" ? "Only the server owner or an administrator can manage events"
            : "Current event membership, permissions or publishing state could not be verified. Inspect current state before another change")))
}
