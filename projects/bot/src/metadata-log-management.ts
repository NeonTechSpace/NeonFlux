import { serverCommands, serverLabel, serverOption, serverText } from "./server-scope.ts"
import type * as C from "@neonflux/backend/contracts"
import { format, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { metadataEventLabel, metadataLogEventSelectors, metadataLogHelp, type MetadataLogChange, type MetadataLogCommand, type MetadataLogParse } from "./metadata-log-command.ts"
import { readMetadataDestinationEvidence, readMetadataLogContext } from "./metadata-log-permissions.ts"
import { metadataLogBinding, MetadataLogsStoreError, type MetadataLogsStore } from "./metadata-log-store.ts"
import { MetadataLogHandlingError, observeMetadataLogRecord } from "./metadata-logs.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { ago, code, onOff, replyText, sendCard, type Card } from "./reply-style.ts"

/** Event overrides per !logs metadata overrides page */
export const OVERRIDE_PAGE = 10
/** NeonFlux's missing permissions in each enabled log channel, or undefined for a channel that could not be checked */
type Checks = ReadonlyMap<string, readonly string[] | undefined>
type Command = (rest: string) => string
const capital = (text: string) => text.replace(/^./, letter => letter.toUpperCase())
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const destination = (channelId: string | undefined, ownerId: string | undefined) => channelId ? `${format.channelMention(channelId)}${ownerId ? `, owner ${format.userMention(ownerId)}` : ""}` : "No channel"
/** The first few channels as mentions, then how many more */
const channels = (ids: readonly string[], shown = 5) => `${ids.slice(0, shown).map(format.channelMention).join(", ")}${ids.length > shown ? ` and ${ids.length - shown} more` : ""}`
/** A record's event in plain words. An audit entry names its action */
const eventLabel = (e: C.MetadataLogsEvent) => metadataEventLabel(e.auditAction === undefined ? e.type : `audit-entry:${e.auditAction}`)
/** !logs metadata status: The state in one line and only what needs a look. Categories and overrides have their own reports */
function statusCard(s: C.MetadataLogsSettings, checks: Checks, command: Command): Card {
    const routed = s.routes.filter(r => r.enabled).length, off = s.eventRoutes.filter(r => !r.enabled).length
    const lacking = [...checks].filter(([, missing]) => missing?.length).map(([id]) => id), unchecked = [...checks].filter(([, missing]) => !missing).map(([id]) => id)
    const state = !s.enabled ? `Off. When on, ${routed} of ${s.routes.length} categories post to a channel` : `${s.quotaPaused ? "On, but paused because the daily limit is reached" : "On"}. ${routed} of ${s.routes.length} categories post to a channel`
    return { title: "Metadata logs", description: `${state}${lacking.length ? `. ${plural(lacking.length, "log channel")} lack${lacking.length === 1 ? "s" : ""} permissions` : ""}`, fields: [
        ...s.eventRoutes.length ? [["Event overrides", `${s.eventRoutes.length}${off ? `, ${off} turned off` : ""}`] as const] : [],
        ["Message events", s.messageChannelIds.length ? `From ${plural(s.messageChannelIds.length, "channel")}${s.excludedChannelIds.length ? `, ${s.excludedChannelIds.length} excluded` : ""}` : "From no channels yet"],
        ...lacking.length ? [["NeonFlux lacks permissions in", channels(lacking)] as const] : [], ...unchecked.length ? [["Could not check permissions in", channels(unchecked)] as const] : [],
        // Storage evicts the oldest record when full, so only a nearly full store is worth a line
        ...s.retained >= s.capacity * 0.8 ? [["Stored events", `${s.retained} of ${s.capacity}. The oldest are removed when full`] as const] : []],
        note: `Send ${code(command("metadata categories"))} for each category${s.eventRoutes.length ? ` and ${code(command("metadata overrides"))} for event overrides` : ""}` }
}
/** !logs metadata categories: One line per category with where it posts and whether NeonFlux can post there */
const categoriesCard = (s: C.MetadataLogsSettings, checks: Checks, command: Command): Card => ({ title: "Metadata log categories",
    description: [...s.enabled ? [] : ["Metadata logs are off, so nothing posts yet"], ...s.routes.map(r => {
        const missing = r.enabled && r.channelId ? checks.get(r.channelId) : [], check = !r.enabled || !r.channelId ? "" : !missing ? ". Permissions could not be checked" : missing.length ? `. NeonFlux lacks ${missing.join(", ")}` : ". NeonFlux can post"
        return `**${capital(r.category)}**: ${r.enabled ? `On in ${destination(r.channelId, r.ownerId)}` : r.channelId ? `Off (${destination(r.channelId, r.ownerId)})` : "Off"}${check}`
    })].join("\n"), note: `Change one with ${code(command("metadata route <category> <channel> <owner> on|off"))}` })
const overrideLine = (r: C.MetadataLogsEventRoute) => `**${metadataEventLabel(r.eventType)}**: ${r.enabled ? `On in ${destination(r.channelId, r.ownerId)}` : "Off, so it never posts"}`
const counterCard = (c: C.MetadataLogsCounters, command: Command): Card => {
    const categories = Object.entries(c.categories).filter(([, count]) => count).map(([category, count]) => `${capital(category)} ${count}`).join(", ")
    const posts = ([[c.queued, "waiting"], [c.reserved, "posting"], [c.failed, "failed"], [c.uncertain, "not confirmed"]] as const).filter(([count]) => count).map(([count, state]) => `${count} ${state}`).join(", ")
    return { title: "Log counters", fields: [["Open tickets", String(c.activeTicketSlots)], ["Moderation cases stored", String(c.retainedModerationCases)],
        ["Metadata events stored", `${c.retainedMetadataRecords}${categories ? `: ${categories}` : ""}`], ["Log posts", posts || "None waiting or failed"]],
        ...c.failed || c.uncertain ? { note: `${code(command("metadata status"))} names log channels NeonFlux cannot post in` } : {} }
}
/** Where a record's log post stands. One that may or may not have posted names the command that checks it */
function deliveryStatus(d: C.MetadataLogsDelivery, command: (rest: string) => string) {
    const where = format.channelMention(d.channelId)
    const state = d.state === "queued" ? `Waiting to post in ${where}` : d.state === "reserved" ? `Posting in ${where}` : d.state === "sent" ? `Posted in ${where}`
        : d.state === "failed" ? `${d.noDispatch ? "Not sent" : "Failed"} in ${where}` : d.state === "cancelled" ? "Cancelled"
            : `Not confirmed yet in ${where}. Run ${code(command(`delivery reconcile ${d.recordNo}`))} to check it`
    return `${state}${d.resolution ? d.resolution === "match" ? ". Checked: still posted" : ". Checked: the message is gone" : ""}`
}
const resourceMention = (type: C.MetadataLogsEventType) => type.startsWith("member-") || type === "bot-join" ? format.userMention : type.startsWith("role-") ? format.roleMention
    : type.startsWith("channel-") || type.startsWith("thread-") ? format.channelMention : undefined
const recordCard = (r: C.MetadataLogsRecord, command: (rest: string) => string): Card => {
    const mention = resourceMention(r.event.type)
    return { title: `Record #${r.recordNo}`, fields: [["Event", `${eventLabel(r.event)}${r.event.category === "audit" ? "" : ` (${capital(r.event.category)})`}${r.event.count > 1 ? `, ${r.event.count} items` : ""}`],
        ["By", r.event.actor.kind === "unknown" ? "Unknown" : format.userMention(r.event.actor.userId)],
        ...(mention && r.event.resourceIds.length ? [["About", r.event.resourceIds.map(mention).join(", ")] as const] : []),
        ...(r.event.channelId ? [["Channel", format.channelMention(r.event.channelId)] as const] : []), ["When", ago(r.event.observedAt)],
        ["Log post", r.delivery ? deliveryStatus(r.delivery, command) : "None"]] }
}
const recordLine = (r: C.MetadataLogsRecord) => `**#${r.recordNo}** ${eventLabel(r.event)}${r.event.actor.kind === "unknown" ? "" : ` by ${format.userMention(r.event.actor.userId)}`}, ${ago(r.event.observedAt)}`

/** Fresh private owner/admin report. Reads never admit log events and failures have no public report fallback */
export function handleMetadataPrivateReport(store: MetadataLogsStore, config: BotConfig, report: Extract<MetadataLogCommand, { type: "query" }>, context: BotEventContext<"messageCreate">) {
    const { operation, next = false, view } = report
    return Effect.gen(function* () {
        const { message, client } = context
        if (message.guildId !== undefined && message.guildId !== config.serverId || message.author.isSystem) return
        const channelId = message.guildId === undefined ? message.channelId : (yield* client.directMessages.open(message.author.id, { timeoutMs: 5000 })).id
        const fresh = yield* readMetadataLogContext(client, config.serverId, message.author.id, channelId, true)
        if (!fresh.privateRead) return yield* Effect.fail(new MetadataLogHandlingError({ stage: "private" }))
        // Reports go to the private DM, which accepts only the fixed !
        const card = (value: Card) => sendCard(client, channelId, config, value)
        const send = (content: string) => Effect.gen(function* () {
            const label = config.scope?.mode === "multi" ? yield* serverLabel(client, config.serverId) : undefined
            yield* client.messages.send(channelId, { content: label ? serverText(content, label) : content, allowedMentions: noMentions }, { timeoutMs: 5000 })
        })
        const command = (rest: string) => `!logs${serverOption(config)} ${rest}`, list = command("events list"), key = pageKey(config.serverId, message, "logs", "events")
        const before = operation.type === "list" && next ? nextPosition<number>(key) : undefined
        if (operation.type === "list" && next && before === undefined) { yield* send(noNextPage(list)); return }
        const overrides = command("metadata overrides"), overrideKey = pageKey(config.serverId, message, "logs", "overrides"), overridePage = view === "overrides" && next ? nextPosition<number>(overrideKey) : 1
        if (overridePage === undefined) { yield* send(noNextPage(overrides)); return }
        const result = yield* store.query({ serverId: config.serverId, context: fresh.context, privateRead: fresh.privateRead, operation: before ? { type: "list", beforeRecordNo: before } : operation }).pipe(
            Effect.catch(() => send("The logs could not be read right now. Try again shortly").pipe(Effect.as(undefined))))
        if (!result) return
        if (result.type === "counters") { yield* card(counterCard(result.counters, command)); return }
        if (result.type === "settings" && view === "overrides") {
            // Overrides keep the order of the event list, so pages stay stable between reads
            const rows = [...result.settings.eventRoutes].sort((a, b) => metadataLogEventSelectors.indexOf(a.eventType) - metadataLogEventSelectors.indexOf(b.eventType))
            const pages = Math.max(1, Math.ceil(rows.length / OVERRIDE_PAGE)), page = Math.min(overridePage, pages)
            rememberPosition(overrideKey, page < pages ? page + 1 : undefined)
            yield* card({ title: "Event overrides", description: rows.slice((page - 1) * OVERRIDE_PAGE, page * OVERRIDE_PAGE).map(overrideLine).join("\n") || "No event overrides. Every event follows its category",
                ...rows.length ? { note: `Send ${code(command("metadata inherit <event>"))} to remove one` } : {}, fields: page < pages ? [["Next", code(`${overrides} next`)]] : [] }); return
        }
        if (result.type === "settings") {
            // NeonFlux's fresh permissions in each enabled destination. Categories check only their own channels
            const checks = new Map<string, readonly string[] | undefined>()
            for (const r of view === "categories" ? result.settings.routes : [...result.settings.routes, ...result.settings.eventRoutes]) {
                if (!r.enabled || !r.channelId || checks.has(r.channelId)) continue
                const evidence = yield* readMetadataDestinationEvidence(client, config.serverId, message.author.id, r.channelId).pipe(Effect.catch(() => Effect.succeed(undefined)))
                checks.set(r.channelId, evidence && [...evidence.permissions.view ? [] : ["View Channel"], ...evidence.permissions.send ? [] : ["Send Messages"], ...evidence.permissions.embed ? [] : ["Embed Links"]])
            }
            yield* card(view === "categories" ? categoriesCard(result.settings, checks, command) : statusCard(result.settings, checks, command)); return
        }
        if (result.type === "record") { yield* card(recordCard(result.record, command)); return }
        if (result.type === "records") {
            rememberPosition(key, result.nextBeforeRecordNo)
            yield* card({ title: "Metadata events", description: result.records.map(recordLine).join("\n") || "No events recorded yet",
                fields: [...result.records.length ? [["Details", code(command("events show <record>"))] as const] : [], ...result.nextBeforeRecordNo ? [["Next", code(`${list} next`)] as const] : []] }); return
        }
    })
}

export function handleMetadataLogCommand(store: MetadataLogsStore, config: BotConfig, command: MetadataLogParse, context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void> }) {
    return Effect.gen(function* () {
        const { message } = context
        if (message.guildId !== undefined && message.guildId !== config.serverId) return
        if ("error" in command || command.type === "help") { yield* context.reply({ content: "error" in command ? command.error : withPrefix(message.guildId === undefined ? serverCommands(metadataLogHelp, config) : metadataLogHelp, replyPrefix(config.serverId, message.guildId)), allowedMentions: noMentions }); return }
        if (command.type === "query") { yield* handleMetadataPrivateReport(store, config, command, context); return }
        if (message.guildId === undefined) return
        yield* manageMetadataLogs(store, config, command, context, worker)
    })
}

/** A configuration change in one sentence */
function changed(change: MetadataLogChange) {
    switch (change.type) {
        case "module": return `Metadata logs are now ${onOff(change.enabled).toLowerCase()}`
        case "route": return `${capital(change.category)} events ${change.enabled ? "now post" : "are off. When on they post"} in ${destination(change.channelId, change.ownerId)}`
        case "clear": return `${capital(change.category)} events no longer have a log channel`
        case "channels": return `Message events now come from ${change.messageChannelIds.map(format.channelMention).join(", ") || "no channels"}. Excluded: ${change.excludedChannelIds.map(format.channelMention).join(", ") || "none"}`
        case "event-route": return change.enabled ? `**${metadataEventLabel(change.eventType)}** events now post in ${destination(change.channelId, change.ownerId)}` : `**${metadataEventLabel(change.eventType)}** events are now off`
        case "event-clear": return `**${metadataEventLabel(change.eventType)}** events now follow their category again`
    }
}

/** A change from a server channel. A failed write is answered here, since nothing else replies to it */
function manageMetadataLogs(store: MetadataLogsStore, config: BotConfig, command: Exclude<MetadataLogParse, { error: string } | { type: "help" } | { type: "query" }>, context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message, client } = context
        const destination = command.type === "manage" && "channelId" in command.operation && command.operation.channelId ? command.operation.channelId : message.channelId
        const fresh = yield* readMetadataLogContext(client, config.serverId, message.author.id, destination)
        let managementContext = fresh.context
        let operation: C.MetadataLogsManageOperation
        if (command.type === "reconcile") {
            const found = yield* store.query({ serverId: config.serverId, context: fresh.context, operation: { type: "show", recordNo: command.recordNo } })
            if (found.type !== "record" || !found.record.delivery) return yield* Effect.fail(new MetadataLogHandlingError({ stage: "response" }))
            operation = { type: "reconcile", binding: metadataLogBinding(found.record.delivery), observation: yield* observeMetadataLogRecord(client, config.serverId, message.author.id, found.record) }
            managementContext = (yield* readMetadataLogContext(client, config.serverId, message.author.id, found.record.delivery.channelId)).context
        } else if (command.operation.type === "forget") operation = command.operation
        else {
            const change = command.operation
            // An enabled route needs its owner's own fresh authority in the destination
            const recipient = change.type === "route" || change.type === "event-route" && change.enabled ? (yield* readMetadataLogContext(client, config.serverId, change.ownerId!, change.channelId!)).context : undefined
            // Chat changes apply to the current revisions, read right before the write, so the last of two changes wins
            const current = yield* store.query({ serverId: config.serverId, context: fresh.context, operation: { type: "settings" } })
            if (current.type !== "settings") return yield* Effect.fail(new MetadataLogHandlingError({ stage: "response" }))
            const { revision, routes, configRevision } = current.settings, routeRevision = (category: C.MetadataLogsCategory) => routes.find(r => r.category === category)!.revision
            operation = change.type === "module" || change.type === "channels" ? { ...change, expectedRevision: revision }
                : change.type === "route" ? { ...change, expectedRevision: routeRevision(change.category), recipientOwner: recipient! }
                : change.type === "clear" ? { ...change, expectedRevision: routeRevision(change.category) }
                : change.type === "event-clear" ? { ...change, expectedRevision: configRevision }
                : { ...change, expectedRevision: configRevision, ...(recipient ? { recipientOwner: recipient } : {}) }
        }
        const result = yield* store.manage({ serverId: config.serverId, messageId: message.id, createdAt: yield* sourceTimestamp(message), context: managementContext, operation })
        if (worker) yield* worker.notify()
        yield* reply(result.duplicate ? "That change was already made. Check !logs metadata status before another change"
            : result.type === "settings" ? command.type === "manage" && command.operation.type !== "forget" ? changed(command.operation) : "Metadata log settings saved"
            : result.type === "forgotten" ? `Record #${result.recordNo} forgotten. Posted log messages stay`
            : `Checked record #${result.record.recordNo}. ${result.record.delivery?.resolution === "match" ? "Its log message is still posted" : result.record.delivery?.resolution === "absent" ? "Its log message is gone" : "Whether it posted is still not confirmed"}`)
    }).pipe(Effect.catch(error => reply(error instanceof MetadataLogsStoreError
        ? error.status === 409 ? "Metadata log settings changed while this command ran. Check !logs metadata status, then send the command again"
            : error.status === 403 ? "Metadata log change denied by current permissions or policy" : "The metadata log change was not confirmed. Check !logs metadata status before another change"
        : "Current permissions, the log channel or the record could not be checked. Nothing was changed").pipe(Effect.asVoid)))
}
