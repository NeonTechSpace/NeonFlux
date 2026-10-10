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
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"

export class EventsHandlingError extends Data.TaggedError("EventsHandlingError")<{ readonly stage: "response" | "grant" }> {}
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
        const ask = (context: C.EventsContext, operation: C.EventsQueryRequest["operation"]) => store.query({ serverId: config.serverId, context, operation })
        // Names are unique in a server, so every later step uses the number and current revision this read returns
        const named = (context: C.EventsContext, name: string) => ask(context, { type: "show", name }).pipe(Effect.flatMap(found =>
            found.type === "event" ? Effect.succeed(found.event) : Effect.fail(new EventsHandlingError({ stage: "response" }))))
        const noNext = (start: string) => reply(withPrefix(noNextPage(start), prefix))
        if (command.type === "list") {
            const current = yield* fresh(), key = pageKey(config.serverId, message, "event", "list"), before = command.next ? nextPosition<number>(key) : 0
            if (before === undefined) { yield* noNext("!event list"); return }
            const result = yield* ask(current, { type: "list", ...(before ? { beforeEventNo: before } : {}) })
            if (result.type !== "events") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            rememberPosition(key, result.nextBeforeEventNo)
            yield* reply([...result.events.map(e => `Event ${e.name}: ${e.title}, ${e.state}. ${prefix}event show ${e.name}`),
                ...(result.events.length ? [] : ["No events in this destination"]), ...(result.nextBeforeEventNo ? [`Next: ${prefix}event list next`] : [])].join("\n"))
            return
        }
        if (command.type === "show") {
            const event = yield* named(yield* fresh(), command.name)
            if (event.channelId !== here) return yield* Effect.fail(new EventsPermissionError({ stage: "destination" }))
            yield* reply(eventDetail(event, prefix))
            return
        }
        if (command.type === "dates") {
            const current = yield* fresh(), event = yield* named(current, command.name), calendar = event.calendar
            if (event.channelId !== here || !calendar) return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            const key = pageKey(config.serverId, message, "event", "dates", event.eventNo), after = command.next ? nextPosition<number>(key) : 0
            if (after === undefined) { yield* noNext(`!event dates ${event.name}`); return }
            const result = yield* ask(current, { type: "dates", eventNo: event.eventNo, ...(after ? { afterOccurrenceNo: after } : {}) })
            if (result.type !== "dates" || result.dates.some(d => d.revision !== event.revision
                || !calendar.dates.some(c => c.startsAt === d.startsAt && c.endsAt === d.endsAt && c.localMinute === d.localMinute && c.offsetMinutes === d.offsetMinutes))) return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            rememberPosition(key, result.nextAfterOccurrenceNo)
            yield* reply([...result.dates.map(d => `Occurrence ${d.occurrenceNo}, ${d.state}: ${d.going} Going, ${d.waitlisted} waiting\n${resolvedEventDateText(d, calendar.zone)}`),
                ...(result.nextAfterOccurrenceNo ? [`Next: ${prefix}event dates ${event.name} next`] : [])].join("\n"))
            return
        }
        if (command.type === "attendees") {
            const current = yield* fresh(), event = yield* named(current, command.name)
            const key = pageKey(config.serverId, message, "event", "attendees", event.eventNo, command.occurrenceNo), after = command.next ? nextPosition<string>(key) : ""
            if (after === undefined) { yield* noNext(`!event attendees ${event.name} ${command.occurrenceNo}`); return }
            const result = yield* ask(current, { type: "attendees", eventNo: event.eventNo, occurrenceNo: command.occurrenceNo, ...(after ? { afterUserId: after } : {}) })
            if (result.type !== "attendees") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            rememberPosition(key, result.nextAfterUserId)
            yield* reply([...result.attendees.map(a => eventAttendeeText(a, message.author.id)), ...(result.attendees.length ? [] : ["No recorded attendance"]),
                ...(result.nextAfterUserId ? [`Next: ${prefix}event attendees ${event.name} ${command.occurrenceNo} next`] : [])].join("\n"))
            return
        }
        if (command.type === "status") {
            const result = yield* ask(yield* fresh(), { type: "status" })
            if (result.type !== "status") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            yield* reply(`Events ${result.settings.enabled ? "On" : "Off"}, discussion threads ${result.settings.threads ? "On" : "Off"}, ${result.definitions}/50 definitions, ${result.occurrences}/200 occurrences, ${result.rsvps}/50000 RSVP records`)
            return
        }
        if (command.type === "delivery-status") {
            const event = yield* named(yield* fresh(), command.name)
            const key = pageKey(config.serverId, message, "event", "status", event.eventNo), after = command.next ? nextPosition<string>(key) : ""
            if (after === undefined) { yield* noNext(`!event status ${event.name}`); return }
            const result = yield* store.delivery({ serverId: config.serverId, operation: { type: "status", eventNo: event.eventNo, ...(after ? { afterDeliveryId: after } : {}) } })
            if (result.type !== "deliveries") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            rememberPosition(key, result.nextAfterDeliveryId)
            yield* reply([eventDetail(event, prefix), ...result.deliveries.map(d => `Occurrence ${d.occurrenceNo}, ${d.offsetMinutes}-minute reminder: ${d.state}, due ${new Date(d.dueAt).toISOString()}${d.postNo ? `, tracked post ${d.postNo}. Reconcile: ${prefix}event reconcile ${event.name} ${d.postNo}` : ""}`),
                ...(result.nextAfterDeliveryId ? [`Next: ${prefix}event status ${event.name} next`] : [])].join("\n"))
            return
        }
        if (command.type === "forget" && !command.confirmed) {
            const event = yield* named(yield* fresh(), command.name)
            yield* reply(`Forgetting removes settled stored event participation and publishing tracking in bounded pages. Native messages stay\nConfirm: ${prefix}event forget ${event.name} confirm`)
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        if (command.type === "reconcile") {
            const permission = yield* fresh(), event = yield* named(permission, command.name)
            const postNo = command.postNo ?? event.cardPostNo
            if (!publishing || !postNo) { yield* reply(`There is no managed card to reconcile. Inspect ${prefix}event status ${event.name} and select an exact retained reminder post number`); return }
            const tracked = yield* publishing.query({ serverId: config.serverId, actor: permission.actor, operation: { type: "post-show", postNo } })
            if (tracked.type !== "post" || tracked.post.consumer?.type !== "event" || tracked.post.consumer.eventNo !== event.eventNo) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
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
            yield* reply(`Event ${event.name}, post ${postNo}: ${result.recorded ? "Observation recorded" : "Observation already current"}, outcome ${result.post.outcome}${result.post.attempt.resolution ? ", current tracking baseline resolved" : ""}. Original delivery outcome is retained. No message was sent, edited or deleted`)
            return
        }
        if (command.type === "rsvp") {
            const current = yield* fresh(), event = yield* named(current, command.name)
            const result = yield* store.rsvp({ serverId: config.serverId, context: current, messageId: message.id, createdAt,
                eventNo: event.eventNo, occurrenceNo: command.occurrenceNo, choice: command.choice })
            if (worker) yield* worker.notify()
            yield* reply(`${result.duplicate ? "Already recorded" : result.accepted ? "RSVP recorded" : "RSVP was not accepted"}. Occurrence ${result.occurrence.occurrenceNo}${result.rsvp ? `\n${eventAttendeeText(result.rsvp, message.author.id)}` : ""}`)
            return
        }
        // Chat changes apply to the current settings or event, so of two staff changes the later one wins
        let operation: C.EventsManageOperation
        let destination = here
        let found: C.EventsDefinition | undefined
        if (command.type === "create") { operation = { ...command }; destination = command.channelId }
        else if (command.type === "module" || command.type === "threads") {
            const current = yield* ask(yield* fresh(), { type: "settings" })
            if (current.type !== "settings") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            operation = { type: command.type === "module" ? "settings" : "threads", enabled: command.enabled, expectedRevision: current.settings.revision }
        } else {
            const staff = yield* fresh(), event = yield* named(staff, command.name), target = { eventNo: event.eventNo, expectedRevision: event.revision }
            found = event
            destination = event.channelId
            if (command.type === "forget") operation = { type: "forget", ...target, confirm: "forget" }
            else if (command.type === "change") {
                const change = command.change
                if (change.type !== "template" || change.templateName === null) operation = { ...change, ...target }
                else {
                    if (!publishing) { yield* reply("Publishing templates are not configured"); return }
                    // The event copies the template as it is now
                    const template = yield* publishing.query({ serverId: config.serverId, actor: staff.actor, operation: { type: "draft-show", kind: "template", name: change.templateName } })
                    if (template.type !== "draft") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
                    operation = { ...change, ...target, expectedTemplateRevision: template.draft.revision }
                }
            } else {
                const current = event.calendar
                if (command.type === "repeat" && !current) { yield* reply(`Set ${prefix}event time before choosing repeat`); return }
                const calendar = command.type === "time" ? createEventCalendar(command.localMinute, command.zone, command.durationMinutes, command.fold, current?.recurrence)
                    : createEventCalendar(current!.localMinute, current!.zone, current!.durationMinutes, current!.fold, command.recurrence)
                const now = yield* Clock.currentTimeMillis
                if (calendar.dates[0]!.startsAt <= now || calendar.dates.at(-1)!.startsAt > now + 180 * 86400000) { yield* reply("Every occurrence must start in the future within 180 days. Choose a shorter finite calendar"); return }
                operation = { type: "calendar", ...target, calendar }
            }
        }
        const isWrite = operation.type === "publish" || found?.cardPostNo !== undefined && !["settings", "cancel", "forget", "reconcile"].includes(operation.type)
        if (!isWrite && operation.type !== "create") destination = here
        const result = yield* store.manage({ serverId: config.serverId, messageId: message.id, createdAt,
            context: yield* readEventsContext(client, config.serverId, message.author.id, destination, { staff: true, write: isWrite, hasEmbed: true, forum: "forum" }), operation })
        if (result.duplicate) { yield* reply("This event command was already recorded. Read current event and delivery status before another change"); return }
        if (worker) yield* worker.notify()
        if (result.type === "settings") yield* reply(`Events ${result.settings.enabled ? "On" : "Off"}, discussion threads ${result.settings.threads ? "On" : "Off"}. Disable preserves data. Overdue reminders skip on resume`)
        else if (result.type === "forgotten") yield* reply(`Event ${found!.name}: ${result.removed} retained records removed, forgetting ${result.complete ? "Complete" : `Incomplete. Continue ${prefix}event forget ${found!.name} confirm with a new message`}. Native messages stay`)
        else {
            if (result.grant) {
                if (!publishing) { yield* reply(`Event ${result.event.name} saved with reserved publishing work. Publishing transport is unavailable. Inspect status and reconcile. No replay`); return }
                const expected = renderEventContent(result.event)
                if (!equalPublishingContent(expected, result.grant.content) || !equalPublishingContent(canonicalPublishingContent(expected), result.grant.canonicalContent)) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
                const outcome = yield* performPublishingGrant(publishing, config.serverId, result.grant.actorId, client, result.grant,
                    () => readEventsContext(client, config.serverId, result.grant!.actorId, result.grant!.channelId, { staff: true, write: true, hasEmbed: !!result.grant!.content.embed, forum: "post" }))
                yield* reply(`Event ${result.event.name} card: ${outcome.outcome}${outcome.acknowledged ? "" : ", outcome acknowledgement unconfirmed"}. ${prefix}event status ${result.event.name}. No automatic replay`)
            }
            yield* reply(eventDetail(result.event, prefix))
        }
    }).pipe(Effect.catch(error => reply(error instanceof EventsStoreError ? withPrefix(eventsErrorMessage(error), prefix) : error instanceof EventCalendarError ? error.message
        : error instanceof EventsPermissionError && error.stage === "administrator" ? "Only the server owner or an administrator can manage events"
            : "Current event membership, permissions or publishing state could not be verified. Inspect current state before another change")))
}
