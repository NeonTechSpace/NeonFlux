import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { scheduleHelp, type ScheduleCommand } from "./schedule-command.ts"
import { createScheduleCalendar, scheduleDateText } from "./schedule-calendar.ts"
import { CivilCalendarError } from "./civil-calendar.ts"
import { readSchedulesContext } from "./schedule-permissions.ts"
import { SchedulesStoreError, schedulesErrorMessage, type SchedulesStore } from "./schedule-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { readPublishingAuthority, verifyPublishingMessage } from "./publishing-permissions.ts"
import { publishingMessageContent } from "./publishing-content.ts"
import { publishingDraftMessage } from "./publishing.ts"
import { SchedulesHandlingError } from "./schedules.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"

export function scheduleDetail(schedule: C.SchedulesDefinition) {
    return [`Schedule ${schedule.scheduleNo}: ${schedule.name}, ${schedule.cancelled ? "Cancelled" : schedule.enabled ? "Enabled" : "Disabled"}, management revision ${schedule.revision}, plan ${schedule.planRevision}`,
        `Created by ${schedule.createdBy}, destination ${schedule.channelId}`,
        `Frozen ${schedule.source.kind} ${schedule.source.name}, source revision ${schedule.source.revision}`,
        ...schedule.calendar.dates.map((date, i) => `Plan date ${i + 1}: ${scheduleDateText(date, schedule.calendar.zone)}`),
        "Enable skips already-due unclaimed work. Read status for retained occurrences and past plans"].join("\n")
}
export function handleScheduleCommand(store: SchedulesStore, publishing: PublishingStore | undefined, config: BotConfig, command: ScheduleCommand | { error: string }, context: BotEventContext<"messageCreate">,
    worker?: { notify: () => Effect.Effect<void> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => Effect.gen(function* () { for (let i = 0; i < content.length; i += 1900) yield* context.reply({ content: content.slice(i, i + 1900), allowedMentions: noMentions }) })
    return Effect.gen(function* () {
        const { client, message } = context
        if (message.guildId !== config.serverId) return
        const fresh = () => readSchedulesContext(client, config.serverId, message.author.id, message.channelId)
        // Even help and parser errors require the human staff boundary for this configuration namespace.
        yield* fresh()
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(withPrefix(scheduleHelp, prefix)); return }
        const query = (operation: C.SchedulesQueryRequest["operation"]) => fresh().pipe(Effect.flatMap(context => store.query({ serverId: config.serverId, context, operation })))
        const show = (scheduleNo: number) => query({ type: "show", scheduleNo }).pipe(Effect.flatMap(result => result.type === "schedule" ? Effect.succeed(result.schedule) : Effect.fail(new SchedulesHandlingError({ stage: "response" }))))
        if (command.type === "query") {
            const result = yield* query(command.operation)
            if (result.type === "schedule") {
                yield* reply(scheduleDetail(result.schedule))
                yield* reply(publishingDraftMessage({ kind: result.schedule.source.kind, name: result.schedule.source.name, revision: result.schedule.source.revision,
                    content: result.schedule.content, canonicalContent: result.schedule.canonicalContent, createdAt: result.schedule.createdAt, updatedAt: result.schedule.updatedAt }))
                yield* context.reply({ content: result.schedule.content.content, embeds: result.schedule.content.embed ? [result.schedule.content.embed] : [], allowedMentions: noMentions })
            } else if (result.type === "schedules") yield* reply([...result.schedules.map(s => `Schedule ${s.scheduleNo}: ${s.name}, ${s.cancelled ? "Cancelled" : s.enabled ? "Enabled" : "Disabled"}, revision ${s.revision}, plan ${s.planRevision}`),
                ...(result.schedules.length ? [] : ["No retained schedules"]), ...(result.nextBeforeScheduleNo ? [`Next: ${prefix}publish schedule list ${result.nextBeforeScheduleNo}`] : [])].join("\n"))
            else if (result.type === "deliveries") yield* reply([...result.deliveries.map(d => `Occurrence ${d.occurrenceNo}, plan ${d.planRevision}: ${d.state}${d.reason ? ` (${d.reason})` : ""}, ${scheduleDateText(d, d.zone)}${d.postNo ? `, tracked post ${d.postNo}` : ""}${d.claimedAt !== undefined ? ", dispatch claimed" : ""}`),
                ...(result.deliveries.length ? [] : ["No retained deliveries"]), ...(result.nextAfterOccurrenceNo && command.operation.type === "deliveries" ? [`Next: ${prefix}publish schedule status ${command.operation.scheduleNo} ${result.nextAfterOccurrenceNo}`] : [])].join("\n"))
            else yield* reply(`Schedules ${result.settings.enabled ? "On" : "Off"}, settings revision ${result.settings.revision}, activation cutoff ${new Date(result.settings.activatedAt).toISOString()}${result.type === "status"
                ? `\n${result.definitions}/50 definitions, ${result.deliveries}/200 retained deliveries, ${result.receipts}/1000 daily receipts\nPublishing ${result.publishing.enabled ? "On" : "Off"}` : ""}`)
            return
        }
        if (command.type === "forget" && !command.confirmed) {
            yield* reply(`Forgetting releases only selected settled tracking and protection. Native posts stay. Pending or uncertain selected ownership blocks removal\nConfirm: ${prefix}publish schedule forget ${command.scheduleNo} ${command.expectedRevision}${command.occurrenceNos ? ` ${command.occurrenceNos.join(" ")}` : ""} confirm`)
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        let operation: C.SchedulesManageOperation
        let destination = message.channelId
        if (command.type === "create" || command.type === "calendar") {
            const calendar = createScheduleCalendar(command.localMinute, command.zone, command.fold, command.recurrence)
            const now = yield* Clock.currentTimeMillis
            if (calendar.dates[0]!.dueAt <= now || calendar.dates.at(-1)!.dueAt > now + 180 * 86400000) { yield* reply("Every new calendar date must be in the future within 180 days. Choose a shorter finite plan"); return }
            if (command.type === "create") { operation = { type: "create", name: command.name, source: command.source, channelId: command.channelId, calendar }; destination = command.channelId }
            else operation = { type: "calendar", scheduleNo: command.scheduleNo, expectedRevision: command.expectedRevision, calendar }
        } else if (command.type === "manage") {
            operation = command.operation
            if (operation.type === "destination") destination = operation.channelId
        } else if (command.type === "forget") operation = { type: "forget", scheduleNo: command.scheduleNo, expectedRevision: command.expectedRevision, confirm: "forget", ...(command.occurrenceNos ? { occurrenceNos: command.occurrenceNos } : {}) }
        else {
            if (!publishing) { yield* reply("Publishing transport is unavailable. Exact known-post reconciliation remains unfinished"); return }
            const current = yield* show(command.scheduleNo)
            if (current.revision !== command.expectedRevision) return yield* Effect.fail(new SchedulesStoreError({ operation: "manage", status: 409 }))
            const staff = yield* fresh()
            const tracked = yield* publishing.query({ serverId: config.serverId, actor: staff.actor, operation: { type: "post-show", postNo: command.postNo } })
            if (tracked.type !== "post" || tracked.post.consumer?.type !== "schedule" || tracked.post.consumer.scheduleNo !== command.scheduleNo)
                return yield* Effect.fail(new SchedulesHandlingError({ stage: "grant" }))
            const post = tracked.post
            if (!post.messageId) { yield* reply(`Post ${post.postNo} has no known native message identity. Reconciliation cannot search for, adopt or resend a message`); return }
            const authority = yield* readPublishingAuthority(client, config.serverId, message.author.id, post.channelId, false, true)
            if (authority.botId !== post.botId) return yield* Effect.fail(new SchedulesHandlingError({ stage: "grant" }))
            const native = yield* client.messages.fetch({ channelId: post.channelId, id: post.messageId }, { timeoutMs: 5000 })
            yield* verifyPublishingMessage(native, { serverId: config.serverId, channelId: post.channelId, messageId: post.messageId, botId: post.botId, verifiedChannel: authority.channel! })
            const content = publishingMessageContent(native)
            if (!content) return yield* Effect.fail(new SchedulesHandlingError({ stage: "grant" }))
            operation = { type: "reconcile", scheduleNo: command.scheduleNo, expectedRevision: command.expectedRevision, deliveryId: post.consumer!.type === "schedule" ? post.consumer!.deliveryId : "",
                attemptId: post.attempt.attemptId, expectedGeneration: post.generation, observation: { observedAt: yield* Clock.currentTimeMillis, messageId: native.id, channelId: native.channelId, botId: native.author.id, content } }
        }
        const result = yield* store.manage({ serverId: config.serverId, messageId: message.id, createdAt, context: yield* readSchedulesContext(client, config.serverId, message.author.id, destination), operation })
        if (result.duplicate) { yield* reply("This schedule command was already recorded. Read current show and status before another change"); return }
        if (worker) yield* worker.notify()
        if (result.type === "settings") yield* reply(`Schedules ${result.settings.enabled ? "On" : "Off"}, settings revision ${result.settings.revision}. Enabling skips already-due unclaimed work and preserves past outcomes`)
        else if (result.type === "schedule") yield* reply(scheduleDetail(result.schedule))
        else if (result.type === "reconciled") yield* reply(`Post ${result.post.postNo}: ${result.recorded ? "Observation recorded" : "Observation already current"}, outcome ${result.post.outcome}${result.post.attempt.resolution ? ", baseline resolved" : ""}. Original delivery history is retained. No message was sent, edited or deleted`)
        else yield* reply(`Schedule ${result.scheduleNo}: ${result.removed} retained records removed, forgetting ${result.complete ? "Complete" : `Incomplete. Continue ${prefix}publish schedule forget ${result.scheduleNo} ${"expectedRevision" in operation ? operation.expectedRevision + 1 : 0}${operation.type === "forget" && operation.occurrenceNos ? ` ${operation.occurrenceNos.join(" ")}` : ""} confirm with a new message`}. Native messages stay`)
    }).pipe(Effect.catch(error => reply(error instanceof SchedulesStoreError ? withPrefix(schedulesErrorMessage(error), prefix) : error instanceof CivilCalendarError ? error.message
        : "Current human owner/admin membership, destination permissions or publishing state could not be verified. Read current state before another change")))
}
