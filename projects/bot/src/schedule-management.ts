import type { SchedulesDefinition, SchedulesDelivery, SchedulesDeliveryReason, SchedulesManageOperation, SchedulesQueryRequest } from "@neonflux/contracts/schedules"
import { format, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { scheduleHelp, type ScheduleCommand, type ScheduleSource } from "./schedule-command.ts"
import { createScheduleCalendar } from "./schedule-calendar.ts"
import { CivilCalendarError } from "./civil-calendar.ts"
import { readSchedulesContext } from "./schedule-permissions.ts"
import { SchedulesStoreError, schedulesErrorMessage, type SchedulesStore } from "./schedule-store.ts"
import { publishingErrorMessage, PublishingStoreError, type PublishingStore } from "./publishing-store.ts"
import { readPublishingAuthority, verifyPublishingMessage } from "./publishing-permissions.ts"
import { publishingMessageContent } from "./publishing-content.ts"
import { checkedPost, unknownMessage } from "./publishing.ts"
import { SchedulesHandlingError } from "./schedules.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { ago, at, code, onOff, replyCard, replyText, usage, type Card } from "./reply-style.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"

const scheduleState = (schedule: SchedulesDefinition) => schedule.cancelled ? "Cancelled" : onOff(schedule.enabled)
/** A schedule's staff summary: Its next date and how many there are. The dates and the post show on request, each in each reader's own time */
export function scheduleDetail(schedule: SchedulesDefinition, prefix: string, now: number): Card {
    const dates = schedule.calendar.dates, next = dates.find(date => date.dueAt > now), command = (verb: string) => code(`${prefix}publish schedule ${verb} ${schedule.name}`)
    return { title: `Schedule ${schedule.name}`, fields: [["Status", scheduleState(schedule)], ["Channel", format.channelMention(schedule.channelId)],
        ["Content", `A copy of ${schedule.source.kind} ${schedule.source.name}`], ["Next date", next ? at(next.dueAt) : "None left"],
        ["Dates", `${dates.length === 1 ? "Once" : `${dates.length} dates, last ${at(dates.at(-1)!.dueAt)}`}, planned in ${schedule.calendar.zone} time`]],
        note: `See the dates with ${command("dates")}, the post with ${command("preview")} and what was sent with ${command("status")}`,
        footer: "Posts that come due while the schedule is off are skipped" }
}
/** Planned dates per page of !publish schedule dates */
const DATES_PAGE = 10
/** The one thing a change to an existing schedule did, with its new value */
function scheduleChange(type: ScheduleCommand["type"], schedule: SchedulesDefinition) {
    const name = `Schedule ${schedule.name}`, dates = schedule.calendar.dates
    switch (type) {
        case "calendar": return `${name} now posts ${dates.length === 1 ? `once, ${at(dates[0]!.dueAt)}` : `${dates.length} times, from ${at(dates[0]!.dueAt)} to ${at(dates.at(-1)!.dueAt)}`}`
        case "content": return `${name} now posts a copy of ${schedule.source.kind} ${schedule.source.name}`
        case "destination": return `${name} now posts in ${format.channelMention(schedule.channelId)}`
        case "cancel": return `${name} cancelled. Its later posts are not sent, and it cannot be turned on again`
        default: return schedule.enabled ? `${name} is on. Posts that were already due are skipped` : `${name} is off. Posts that come due while it is off are skipped`
    }
}
const reasons: Record<SchedulesDeliveryReason, string> = { "activation-cutoff": "it came due while schedules were off", "late-window": "NeonFlux could not send it in time", superseded: "the plan changed",
    cancelled: "the schedule was cancelled", permission: "NeonFlux could not post in the channel", capacity: "the posting limits were full", "dispatch-expired": "sending took too long" }
export function handleScheduleCommand(store: SchedulesStore, publishing: PublishingStore, config: BotConfig, command: ScheduleCommand | { error: string }, context: BotEventContext<"messageCreate">,
    worker?: { notify: () => Effect.Effect<void> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        const { client, message } = context
        if (message.guildId !== config.serverId) return
        const fresh = () => readSchedulesContext(client, config.serverId, message.author.id, message.channelId)
        // Even help and parser errors require the human staff boundary for this configuration namespace.
        yield* fresh()
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(withPrefix(scheduleHelp, prefix)); return }
        const query = (operation: SchedulesQueryRequest["operation"]) => fresh().pipe(Effect.flatMap(context => store.query({ serverId: config.serverId, context, operation })))
        const show = (name: string) => query({ type: "show", name }).pipe(Effect.flatMap(result => result.type === "schedule" ? Effect.succeed(result.schedule) : Effect.fail(new SchedulesHandlingError({ stage: "response" }))))
        if (command.type === "status" || command.type === "show" || command.type === "list" || command.type === "deliveries" || command.type === "dates" || command.type === "preview") {
            const start = command.type === "deliveries" ? `!publish schedule status ${command.name}` : command.type === "dates" ? `!publish schedule dates ${command.name}` : "!publish schedule list"
            const key = pageKey(config.serverId, message, start)
            const position = (command.type === "list" || command.type === "deliveries" || command.type === "dates") && command.next ? nextPosition<number>(key) : 0
            if (position === undefined) { yield* reply(withPrefix(noNextPage(start), prefix)); return }
            const result = yield* command.type === "status" ? query({ type: "status" }) : command.type === "show" || command.type === "dates" || command.type === "preview" ? query({ type: "show", name: command.name })
                : command.type === "list" ? query({ type: "list", ...(position ? { beforeScheduleNo: position } : {}) })
                : show(command.name).pipe(Effect.flatMap(schedule => query({ type: "deliveries", scheduleNo: schedule.scheduleNo, ...(position ? { afterOccurrenceNo: position } : {}) })))
            const next = (more: unknown): NonNullable<Card["fields"]> => more ? [["Next", code(`${withPrefix(start, prefix)} next`)]] : []
            if (result.type === "schedule") {
                const schedule = result.schedule, dates = schedule.calendar.dates
                if (command.type === "preview") {
                    yield* reply(`Preview of schedule ${schedule.name}, a copy of ${schedule.source.kind} ${schedule.source.name}:`)
                    yield* context.reply({ content: schedule.content.content, embeds: schedule.content.embed ? [schedule.content.embed] : [], allowedMentions: noMentions })
                } else if (command.type === "dates") {
                    // The plan is read whole, so its dates page by number. Date numbers belong to posts, so the plan's dates are not numbered
                    const pages = Math.ceil(dates.length / DATES_PAGE), page = Math.min(position || 1, pages), shown = dates.slice((page - 1) * DATES_PAGE, page * DATES_PAGE)
                    rememberPosition(key, page < pages ? page + 1 : undefined)
                    yield* card({ title: `Schedule ${schedule.name} dates`, description: [`${dates.length === 1 ? "One date" : `Dates ${(page - 1) * DATES_PAGE + 1} to ${(page - 1) * DATES_PAGE + shown.length} of ${dates.length}`}, `
                        + `planned in ${schedule.calendar.zone} time`, ...shown.map(date => `- ${at(date.dueAt)}`)].join("\n"), fields: next(page < pages) })
                } else yield* card(scheduleDetail(schedule, prefix, yield* Clock.currentTimeMillis))
            } else if (result.type === "schedules") {
                rememberPosition(key, result.nextBeforeScheduleNo)
                yield* card({ title: "Schedules", description: result.schedules.map(s => `**${s.name}** ${scheduleState(s)}`).join("\n") || "No schedules yet", fields: next(result.nextBeforeScheduleNo) })
            } else if (result.type === "deliveries") {
                rememberPosition(key, result.nextAfterOccurrenceNo)
                const name = command.type === "deliveries" ? command.name : "", why = (d: SchedulesDelivery) => d.reason ? `, because ${reasons[d.reason]}` : ""
                const state = (d: SchedulesDelivery) => d.state === "queued" ? `Due ${at(d.dueAt)}` : d.state === "blocked" ? `Due ${at(d.dueAt)}. Waiting until NeonFlux can post in ${format.channelMention(d.channelId)}`
                    : d.state === "reserved" ? "Sending now" : d.state === "uncertain" ? `Not confirmed yet${d.postNo ? `, post #${d.postNo}` : ""}`
                    : d.state === "superseded" ? "Replaced by a changed plan" : `${{ sent: "Sent", failed: "Could not be sent", skipped: "Skipped", cancelled: "Cancelled" }[d.state]}${why(d)}. It was due ${at(d.dueAt)}`
                // Posts that are not confirmed share one hint instead of a command on each line
                yield* card({ title: `Schedule ${name} posts`, description: result.deliveries.map(d => `**Date ${d.occurrenceNo}:** ${state(d)}`).join("\n") || "No posts yet", fields: next(result.nextAfterOccurrenceNo),
                    ...(result.deliveries.some(d => d.state === "uncertain" && d.postNo) ? { note: `Check a post that is not confirmed with ${code(`${prefix}publish schedule reconcile ${name} <post>`)}` } : {}) })
            } else yield* card({ title: "Schedules", fields: [["Status", onOff(result.settings.enabled)], ...(result.settings.enabled && result.settings.activatedAt ? [["Turned on", ago(result.settings.activatedAt)] as const] : []),
                ...(result.type === "status" ? [["Publishing", result.publishing.enabled ? "On" : `Off. Schedules post nothing until ${code(`${prefix}publish module on`)}`],
                    ["Schedules", usage(result.definitions, 50)], ["Planned posts", usage(result.deliveries, 200)],
                    ...(result.receipts >= 800 ? [["Changes today", `${result.receipts} of 1000`] as const] : [])] as const : [])] })
            return
        }
        const occurrences = (occurrenceNos?: number[]) => occurrenceNos ? ` ${occurrenceNos.join(" ")}` : ""
        if (command.type === "forget" && !command.confirmed) {
            yield* reply(`Forgetting removes the stored records of ${command.occurrenceNos ? "these dates" : "the settled posts"} of schedule ${command.name} in steps. Posted messages stay, and posts still sending or not confirmed are kept\nConfirm: ${code(`${prefix}publish schedule forget ${command.name}${occurrences(command.occurrenceNos)} confirm`)}`)
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const plan = command.type === "create" || command.type === "calendar" ? createScheduleCalendar(command.localMinute, command.zone, command.fold, command.recurrence) : undefined
        if (plan) {
            const now = yield* Clock.currentTimeMillis
            if (plan.dates[0]!.dueAt <= now || plan.dates.at(-1)!.dueAt > now + 180 * 86400000) { yield* reply("Every date must be in the future and within 180 days. Choose fewer dates or an earlier start"); return }
        }
        // Chat changes apply to the current state: The bot reads the current revisions right before the write, so the later of two staff changes wins
        const source = (selected: ScheduleSource) => fresh().pipe(Effect.flatMap(staff => publishing.query({ serverId: config.serverId, actor: staff.actor, operation: { type: "draft-show", ...selected } })),
            Effect.flatMap(found => found.type === "draft" ? Effect.succeed({ ...selected, revision: found.draft.revision }) : Effect.fail(new SchedulesHandlingError({ stage: "response" }))))
        let operation: SchedulesManageOperation
        let destination = message.channelId
        if (command.type === "module") {
            const current = yield* query({ type: "settings" })
            if (current.type !== "settings") return yield* Effect.fail(new SchedulesHandlingError({ stage: "response" }))
            operation = { type: "settings", enabled: command.enabled, expectedRevision: current.settings.revision }
        } else if (command.type === "create") {
            operation = { type: "create", name: command.name, source: yield* source(command.source), channelId: command.channelId, calendar: plan! }
            destination = command.channelId
        } else {
            const current = yield* show(command.name), target = { scheduleNo: current.scheduleNo, expectedRevision: current.revision }
            if (command.type === "calendar") operation = { type: "calendar", ...target, calendar: plan! }
            else if (command.type === "content") operation = { type: "content", ...target, source: yield* source(command.source) }
            else if (command.type === "destination") { operation = { type: "destination", ...target, channelId: command.channelId }; destination = command.channelId }
            else if (command.type === "forget") operation = { type: "forget", ...target, confirm: "forget", ...(command.occurrenceNos ? { occurrenceNos: command.occurrenceNos } : {}) }
            else if (command.type === "reconcile") {
                const staff = yield* fresh()
                const tracked = yield* publishing.query({ serverId: config.serverId, actor: staff.actor, operation: { type: "post-show", postNo: command.postNo } })
                if (tracked.type !== "post" || tracked.post.consumer?.type !== "schedule" || tracked.post.consumer.scheduleNo !== current.scheduleNo)
                    return yield* Effect.fail(new SchedulesHandlingError({ stage: "grant" }))
                const post = tracked.post
                if (!post.messageId) { yield* reply(unknownMessage(post)); return }
                const authority = yield* readPublishingAuthority(client, config.serverId, message.author.id, post.channelId, false, true)
                if (authority.botId !== post.botId) return yield* Effect.fail(new SchedulesHandlingError({ stage: "grant" }))
                const native = yield* client.messages.fetch({ channelId: post.channelId, id: post.messageId }, { timeoutMs: 5000 })
                yield* verifyPublishingMessage(native, { serverId: config.serverId, channelId: post.channelId, messageId: post.messageId, botId: post.botId, verifiedChannel: authority.channel! })
                const content = publishingMessageContent(native)
                if (!content) return yield* Effect.fail(new SchedulesHandlingError({ stage: "grant" }))
                operation = { type: "reconcile", ...target, deliveryId: post.consumer!.type === "schedule" ? post.consumer!.deliveryId : "",
                    attemptId: post.attempt.attemptId, expectedGeneration: post.generation, observation: { originServerId: config.serverId, observedAt: yield* Clock.currentTimeMillis, messageId: native.id, channelId: native.channelId, botId: native.author.id, content } }
            } else operation = { type: command.type, ...target }
        }
        const result = yield* store.manage({ serverId: config.serverId, messageId: message.id, createdAt, context: yield* readSchedulesContext(client, config.serverId, message.author.id, destination), operation })
        if (result.duplicate) { yield* reply("This command was already handled, so nothing changed again"); return }
        if (worker) yield* worker.notify()
        if (result.type === "settings") yield* reply(result.settings.enabled ? "Schedules are on. Posts that came due while schedules were off are skipped" : "Schedules are off. Schedules and past posts are kept")
        // A new schedule shows its whole detail, and a change to one names what changed
        else if (result.type === "schedule") yield* command.type === "create" ? card(scheduleDetail(result.schedule, prefix, yield* Clock.currentTimeMillis)) : reply(scheduleChange(command.type, result.schedule))
        else if (result.type === "reconciled") yield* reply(checkedPost(result.post, `Post #${result.post.postNo} of schedule ${command.type === "reconcile" ? command.name : ""}`))
        else if (command.type === "forget") yield* reply(result.complete ? `Schedule ${command.name}: ${result.removed} record${result.removed === 1 ? "" : "s"} removed. Posted messages stay`
            : `Removed ${result.removed} record${result.removed === 1 ? "" : "s"} of schedule ${command.name} so far\nContinue: ${code(`${prefix}publish schedule forget ${command.name}${occurrences(command.occurrenceNos)} confirm`)}`)
    }).pipe(Effect.catch(error => reply(error instanceof SchedulesStoreError ? withPrefix(schedulesErrorMessage(error), prefix) : error instanceof PublishingStoreError ? publishingErrorMessage(error)
        : error instanceof CivilCalendarError ? error.message : "NeonFlux could not check your access, the channel or the post. Check the schedule before you try again")))
}
