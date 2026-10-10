import type { EventsDefinition, EventsContext, EventsQueryRequest, EventsDelivery, EventsManageOperation } from "@neonflux/contracts/events"
import { format, links, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { eventHelp, eventPublic, type EventCommand } from "./event-command.ts"
import { createEventCalendar, EventCalendarError } from "./event-calendar.ts"
import { eventDetail, eventAttendeeText, eventStates, eventTimes, renderEventContent } from "./event-render.ts"
import { EventsStoreError, eventsErrorMessage, type EventsStore } from "./event-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { checkedPost, grantOutcome, performPublishingGrant, unknownMessage } from "./publishing.ts"
import { canonicalPublishingContent, equalPublishingContent } from "@neonflux/contracts/publishing-base"
import { publishingMessageContent } from "./publishing-content.ts"
import { EventsPermissionError, readEventsContext, readPublishingAuthority, verifyPublishingMessage } from "./publishing-permissions.ts"
import { moderationActor } from "./moderation.ts"
import { sourceTimestamp } from "./responses.ts"
import { ago, at, code, duration, notSetUp, onOff, replyCard, replyText, usage, type Card } from "./reply-style.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { readCommandChannel } from "./fluxerly-next.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"

export class EventsHandlingError extends Data.TaggedError("EventsHandlingError")<{ readonly stage: "response" | "grant" }> {}
/** A link to a message, or undefined when its IDs cannot form one */
function messageLink(messageId: string, channelId: string, serverId: string) {
    try { return links.message({ id: messageId, channelId }, { id: channelId, guildId: serverId }) } catch { return undefined }
}
/** The one thing a change to an existing event did, with its new value */
function eventChange(command: EventCommand, event: EventsDefinition) {
    const name = `Event ${event.name}`, dates = event.calendar?.dates ?? []
    if (command.type === "time" || command.type === "repeat") return !dates.length ? `${name} has no dates now`
        : `${name} now runs ${dates.length === 1 ? "once" : `on ${dates.length} dates`}, ${dates.length === 1 ? "" : "first "}${eventTimes(dates[0]!)}`
    const change = command.type === "change" ? command.change : undefined
    if (change?.type === "content") return `${name} is now titled ${event.title}`
    if (change?.type === "capacity") return event.capacity === null ? `${name} has no seat limit now` : `${name} now has ${event.capacity} seat${event.capacity === 1 ? "" : "s"}`
    if (change?.type === "reminders") return event.reminderOffsets.length ? `${name} now sends reminders ${event.reminderOffsets.map(m => duration(m * 60)).join(" and ")} before the start` : `${name} sends no reminders now`
    if (change?.type === "template") return event.template ? `${name} now uses template ${event.template.name}` : `${name} no longer uses a template`
    return change?.type === "cancel" ? `${name} cancelled` : `${name} is ${eventStates[event.state].toLowerCase()}`
}
export function handleEventCommand(store: EventsStore, publishing: PublishingStore | undefined, config: BotConfig, command: EventCommand | { error: string },
    context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
    const next = (command: string | undefined): NonNullable<Card["fields"]> => command ? [["Next", code(`${prefix}${command} next`)]] : []
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
        const ask = (context: EventsContext, operation: EventsQueryRequest["operation"]) => store.query({ serverId: config.serverId, context, operation })
        // Names are unique in a server, so every later step uses the number and current revision this read returns
        const named = (context: EventsContext, name: string) => ask(context, { type: "show", name }).pipe(Effect.flatMap(found =>
            found.type === "event" ? Effect.succeed(found.event) : Effect.fail(new EventsHandlingError({ stage: "response" }))))
        const noNext = (start: string) => reply(withPrefix(noNextPage(start), prefix))
        // Where the event card stands, in plain words read from its post. A forum event's card is the first message of its own post
        const cardState = (current: EventsContext, event: EventsDefinition) => {
            const where = format.channelMention(event.postId ?? event.channelId), postNo = event.cardPostNo
            if (!postNo) return Effect.succeed("Not published yet")
            if (!publishing) return Effect.succeed(`Published in ${where}`)
            return publishing.query({ serverId: config.serverId, actor: current.actor, operation: { type: "post-show", postNo } }).pipe(Effect.map(found => {
                if (found.type !== "post") return `Published in ${where}`
                const post = found.post, url = post.messageId && !event.postId ? messageLink(post.messageId, post.channelId, config.serverId) : undefined, link = url ? `. [Open it](${url})` : ""
                return post.outcome === "sent" ? `Posted in ${where} ${ago(post.createdAt)}${link}` : post.outcome === "pending" ? `Sending to ${where}`
                    : post.outcome === "failed" ? `Could not be posted in ${where}` : `Not confirmed yet. Check it with ${code(`${prefix}event reconcile ${event.name}`)}`
            }), Effect.catch(() => Effect.succeed(`Published in ${where}`)))
        }
        if (command.type === "list") {
            const current = yield* fresh(), key = pageKey(config.serverId, message, "event", "list"), before = command.next ? nextPosition<number>(key) : 0
            if (before === undefined) { yield* noNext("!event list"); return }
            const result = yield* ask(current, { type: "list", ...(before ? { beforeEventNo: before } : {}) })
            if (result.type !== "events") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            rememberPosition(key, result.nextBeforeEventNo)
            yield* card({ title: "Events", description: result.events.map(e => `**${e.name}** ${e.title}, ${eventStates[e.state].toLowerCase()}`).join("\n") || "No events in this channel yet",
                fields: next(result.nextBeforeEventNo ? "event list" : undefined), ...(result.events.length ? { note: `Details: ${code(`${prefix}event show <name>`)}` } : {}) })
            return
        }
        if (command.type === "show") {
            const event = yield* named(yield* fresh(), command.name)
            if (event.channelId !== here) return yield* Effect.fail(new EventsPermissionError({ stage: "destination" }))
            yield* card(eventDetail(event, prefix))
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
            // One line per date: The number that rsvp takes, its start, and a state other than open
            yield* card({ title: `Event ${event.name} dates`, description: result.dates.map(d =>
                `**Date ${d.occurrenceNo}** ${at(d.startsAt)}${d.state === "open" ? "" : `, ${eventStates[d.state].toLowerCase()}`}, ${d.going} going${d.waitlisted ? `, ${d.waitlisted} waiting` : ""}`).join("\n"),
                fields: next(result.nextAfterOccurrenceNo ? `event dates ${event.name}` : undefined), note: `Reply with ${code(`${prefix}event rsvp ${event.name} <date> going|maybe|not-going|none`)}` })
            return
        }
        if (command.type === "attendees") {
            const current = yield* fresh(), event = yield* named(current, command.name)
            const key = pageKey(config.serverId, message, "event", "attendees", event.eventNo, command.occurrenceNo), after = command.next ? nextPosition<string>(key) : ""
            if (after === undefined) { yield* noNext(`!event attendees ${event.name} ${command.occurrenceNo}`); return }
            const result = yield* ask(current, { type: "attendees", eventNo: event.eventNo, occurrenceNo: command.occurrenceNo, ...(after ? { afterUserId: after } : {}) })
            if (result.type !== "attendees") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            rememberPosition(key, result.nextAfterUserId)
            yield* card({ title: `Event ${event.name}, date ${command.occurrenceNo}`, description: result.attendees.map(a => eventAttendeeText(a, message.author.id)).join("\n") || "No replies yet",
                fields: next(result.nextAfterUserId ? `event attendees ${event.name} ${command.occurrenceNo}` : undefined) })
            return
        }
        if (command.type === "status") {
            const result = yield* ask(yield* fresh(), { type: "status" })
            if (result.type !== "status") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            // Limits show only once they are nearly reached
            yield* card({ title: "Events", fields: [["Status", onOff(result.settings.enabled)], ["Discussion threads", onOff(result.settings.threads)],
                ["Events", usage(result.definitions, 50)], ["Dates", usage(result.occurrences, 200)], ...(result.rsvps >= 40000 ? [["Replies", `${result.rsvps} of 50000`] as const] : [])] })
            return
        }
        if (command.type === "delivery-status") {
            const current = yield* fresh(), event = yield* named(current, command.name)
            const key = pageKey(config.serverId, message, "event", "status", event.eventNo), after = command.next ? nextPosition<string>(key) : ""
            if (after === undefined) { yield* noNext(`!event status ${event.name}`); return }
            const result = yield* store.delivery({ serverId: config.serverId, operation: { type: "status", eventNo: event.eventNo, ...(after ? { afterDeliveryId: after } : {}) } })
            if (result.type !== "deliveries") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            rememberPosition(key, result.nextAfterDeliveryId)
            const where = format.channelMention(event.channelId), once = (event.calendar?.dates.length ?? 0) <= 1
            const reminder = (d: EventsDelivery) => d.state === "queued" ? `Due ${at(d.dueAt)}` : d.state === "blocked" ? `Due ${at(d.dueAt)}. Waiting until NeonFlux can post in ${where}`
                : d.state === "reserved" ? "Sending now" : d.state === "uncertain" ? `Not confirmed yet${d.postNo ? `, post #${d.postNo}` : ""}`
                : `${{ sent: "Sent", failed: "Could not be sent", skipped: "Skipped", cancelled: "Cancelled" }[d.state]}, was due ${at(d.dueAt)}`
            // A one-date event names no date, and a repeating one names each date by when it starts
            const label = (d: EventsDelivery) => `${once ? "" : `${at(d.startsAt)}, `}${duration(d.offsetMinutes * 60)} before`
            yield* card({ title: `Event ${event.name} reminders`, description: result.deliveries.map(d => `**${label(d)}:** ${reminder(d)}`).join("\n")
                || (event.reminderOffsets.length ? "No reminders planned yet" : "Reminders are off"), fields: [["Event", eventStates[event.state]], ["Card", yield* cardState(current, event)],
                ...next(result.nextAfterDeliveryId ? `event status ${event.name}` : undefined)],
                ...(result.deliveries.some(d => d.state === "uncertain" && d.postNo) ? { note: `Check a reminder that is not confirmed with ${code(`${prefix}event reconcile ${event.name} <post>`)}` } : {}) })
            return
        }
        if (command.type === "forget" && !command.confirmed) {
            const event = yield* named(yield* fresh(), command.name)
            yield* reply(`Forgetting removes event ${event.name} and its stored replies in steps. Posted messages stay\nConfirm: ${code(`${prefix}event forget ${event.name} confirm`)}`)
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        if (command.type === "reconcile") {
            const permission = yield* fresh(), event = yield* named(permission, command.name)
            const postNo = command.postNo ?? event.cardPostNo
            if (!publishing || !postNo) { yield* reply(`Event ${event.name} has no posted card. Find a reminder's post number with ${code(`${prefix}event status ${event.name}`)}`); return }
            const tracked = yield* publishing.query({ serverId: config.serverId, actor: permission.actor, operation: { type: "post-show", postNo } })
            if (tracked.type !== "post" || tracked.post.consumer?.type !== "event" || tracked.post.consumer.eventNo !== event.eventNo) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
            const post = tracked.post
            if (!post.messageId) { yield* reply(unknownMessage(post)); return }
            const authority = yield* readPublishingAuthority(client, config.serverId, message.author.id, post.channelId, false, true, false, "post")
            if (authority.botId !== post.botId) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
            const native = yield* client.messages.fetch({ channelId: post.channelId, id: post.messageId }, { timeoutMs: 5000 })
            yield* verifyPublishingMessage(native, { serverId: config.serverId, channelId: post.channelId, messageId: post.messageId, botId: post.botId, verifiedChannel: authority.channel! })
            const content = publishingMessageContent(native)
            if (!content) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
            const result = yield* publishing.reconcile({ serverId: config.serverId, actor: moderationActor(authority), messageId: message.id, createdAt, postNo,
                attemptId: post.attempt.attemptId, expectedGeneration: post.generation, observation: { originServerId: config.serverId, observedAt: yield* Clock.currentTimeMillis, messageId: native.id, channelId: native.channelId, botId: native.author.id, content } })
            yield* reply(checkedPost(result.post, `${tracked.post.consumer.purpose === "reminder" ? "The reminder" : "The card"} of event ${event.name}`))
            return
        }
        if (command.type === "rsvp") {
            const current = yield* fresh(), event = yield* named(current, command.name)
            const result = yield* store.rsvp({ serverId: config.serverId, context: current, messageId: message.id, createdAt,
                eventNo: event.eventNo, occurrenceNo: command.occurrenceNo, choice: command.choice })
            if (worker) yield* worker.notify()
            const date = `Event ${event.name}, date ${result.occurrence.occurrenceNo}`
            yield* reply(!result.accepted && !result.duplicate ? `${date}: Your reply was not accepted` : `${date}: ${result.rsvp ? eventAttendeeText(result.rsvp, message.author.id) : "Your reply is recorded"}`)
            return
        }
        // Chat changes apply to the current settings or event, so of two staff changes the later one wins
        let operation: EventsManageOperation
        let destination = here
        let found: EventsDefinition | undefined
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
                    if (!publishing) { yield* reply(notSetUp("Publishing")); return }
                    // The event copies the template as it is now
                    const template = yield* publishing.query({ serverId: config.serverId, actor: staff.actor, operation: { type: "draft-show", kind: "template", name: change.templateName } })
                    if (template.type !== "draft") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
                    operation = { ...change, ...target, expectedTemplateRevision: template.draft.revision }
                }
            } else {
                const current = event.calendar
                if (command.type === "repeat" && !current) { yield* reply(`Set the first date with ${code(`${prefix}event time ${event.name} …`)} before choosing repeat`); return }
                const calendar = command.type === "time" ? createEventCalendar(command.localMinute, command.zone, command.durationMinutes, command.fold, current?.recurrence)
                    : createEventCalendar(current!.localMinute, current!.zone, current!.durationMinutes, current!.fold, command.recurrence)
                const now = yield* Clock.currentTimeMillis
                if (calendar.dates[0]!.startsAt <= now || calendar.dates.at(-1)!.startsAt > now + 180 * 86400000) { yield* reply("Every date must start in the future and within 180 days. Choose fewer dates or an earlier start"); return }
                operation = { type: "calendar", ...target, calendar }
            }
        }
        const isWrite = operation.type === "publish" || found?.cardPostNo !== undefined && !["settings", "cancel", "forget", "reconcile"].includes(operation.type)
        if (!isWrite && operation.type !== "create") destination = here
        const result = yield* store.manage({ serverId: config.serverId, messageId: message.id, createdAt,
            context: yield* readEventsContext(client, config.serverId, message.author.id, destination, { staff: true, write: isWrite, hasEmbed: true, forum: "forum" }), operation })
        if (result.duplicate) { yield* reply("This command was already handled, so nothing changed again"); return }
        if (worker) yield* worker.notify()
        if (result.type === "settings") yield* reply(command.type === "threads" ? result.settings.threads ? "Events published from now on get a discussion thread" : "Discussion threads are off"
            : result.settings.enabled ? "Events are on. Reminders that came due while events were off are skipped" : "Events are off. Events and replies are kept")
        else if (result.type === "forgotten") yield* reply(result.complete ? `Event ${found!.name} forgotten, ${result.removed} record${result.removed === 1 ? "" : "s"} removed. Posted messages stay`
            : `Removed ${result.removed} record${result.removed === 1 ? "" : "s"} of event ${found!.name} so far\nContinue: ${code(`${prefix}event forget ${found!.name} confirm`)}`)
        else {
            let posted: string | undefined
            if (result.grant) {
                const status = code(`${prefix}event status ${result.event.name}`)
                if (!publishing) { yield* reply(`Event ${result.event.name} is saved, but its card was not posted. ${notSetUp("Publishing")}`); return }
                const expected = renderEventContent(result.event)
                if (!equalPublishingContent(expected, result.grant.content) || !equalPublishingContent(canonicalPublishingContent(expected), result.grant.canonicalContent)) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
                const outcome = yield* performPublishingGrant(publishing, config.serverId, result.grant.actorId, client, result.grant,
                    () => readEventsContext(client, config.serverId, result.grant!.actorId, result.grant!.channelId, { staff: true, write: true, hasEmbed: !!result.grant!.content.embed, forum: "post" }))
                posted = grantOutcome(outcome, `The card of event ${result.event.name}`, result.grant, code(`${prefix}event reconcile ${result.event.name}`), status)
            }
            // A new event shows its whole detail. A change names what changed, followed by what happened to its posted card
            if (command.type === "create") { if (posted) yield* reply(posted); yield* card(eventDetail(result.event, prefix)) }
            else yield* reply(command.type === "change" && command.change.type === "publish" && posted ? posted : [eventChange(command, result.event), posted].filter(Boolean).join(". "))
        }
    }).pipe(Effect.catch(error => reply(error instanceof EventsStoreError ? withPrefix(eventsErrorMessage(error), prefix) : error instanceof EventCalendarError ? error.message
        : error instanceof EventsPermissionError && error.stage === "administrator" ? "Only the server owner or an administrator can manage events"
            : "NeonFlux could not check your access, the event's channel or its posted card. Check the event before you try again")))
}
