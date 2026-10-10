import { serverCommands, serverOption, serverReply } from "./server-scope.ts"
import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { metadataLogHelp, type MetadataLogParse } from "./metadata-log-command.ts"
import { readMetadataDestinationEvidence, readMetadataLogContext } from "./metadata-log-permissions.ts"
import { metadataLogBinding, MetadataLogsStoreError, type MetadataLogsStore } from "./metadata-log-store.ts"
import { MetadataLogHandlingError, observeMetadataLogRecord } from "./metadata-logs.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"

export const metadataLogSettingsDetail = (s: C.MetadataLogsSettings) => [`Metadata module ${s.enabled ? "On" : "Off"}`, `Retained ${s.retained}/${s.capacity}, admissions ${s.admissions}/${s.admissionCapacity} in current 24-hour window, suppressed ${s.suppressed}. The oldest records are evicted at capacity`,
    ...s.routes.map(r => `${r.category}: ${r.enabled ? "Enabled" : "Disabled"}, destination ${r.channelId ?? "Unconfigured"}, owner ${r.ownerId ?? "Unconfigured"}`),
    ...s.eventRoutes.map(r => `${r.eventType}: ${r.enabled ? "Specific destination" : "Disabled override"}, destination ${r.channelId ?? "None"}, owner ${r.ownerId ?? "None"}`),
    `Message opt-in channels: ${s.messageChannelIds.join(", ") || "None"}`, `Excluded channels: ${s.excludedChannelIds.join(", ") || "None"}`].join("\n")
const counterDetail = (c: C.MetadataLogsCounters) => [`Active ticket slots ${c.activeTicketSlots}: ${c.definitions.tickets}`, `Moderation cases ${c.retainedModerationCases}: ${c.definitions.moderation}`, `Metadata records ${c.retainedMetadataRecords}: ${c.definitions.metadata}`,
    ...Object.entries(c.categories).map(([k, v]) => `${k}: ${v}`), `Deliveries queued ${c.queued}, reserved ${c.reserved}, failed ${c.failed}, uncertain ${c.uncertain}: ${c.definitions.deliveries}`, `Refused ${c.refused}, suppressed ${c.suppressed}`].join("\n")
const recordDetail = (r: C.MetadataLogsRecord) => [`Record ${r.recordNo}: ${r.event.category}/${r.event.type}, ${r.event.count} observed item(s)`, `Actor ${r.event.actor.kind === "unknown" ? "Unknown" : `${r.event.actor.userId} (${r.event.actor.kind})`}`, `Resource sample ${r.event.resourceIds.join(", ") || "None"}`, `Source ${r.event.source.kind}, observed ${r.event.observedAt}, admitted ${r.admittedAt}`,
    r.delivery ? `Delivery ${r.delivery.state}, generation ${r.delivery.generation}, route revision ${r.delivery.routeRevision}, destination ${r.delivery.channelId}, owner ${r.delivery.ownerId}${r.delivery.messageId ? `, message ${r.delivery.messageId}` : ""}${r.delivery.noDispatch ? ", proven no dispatch" : ""}${r.delivery.resolution ? `, observed ${r.delivery.resolution}` : ""}` : "No delivery bound"].join("\n")

/** Fresh private owner/admin report. Reads never admit log events and failures have no public report fallback */
export function handleMetadataPrivateReport(store: MetadataLogsStore, config: BotConfig, operation: C.MetadataLogsQueryOperation, context: BotEventContext<"messageCreate">, next = false) {
    return Effect.gen(function* () {
        const { message, client } = context
        if (message.guildId !== undefined && message.guildId !== config.serverId || message.author.isSystem) return
        const channelId = message.guildId === undefined ? message.channelId : (yield* client.directMessages.open(message.author.id, { timeoutMs: 5000 })).id
        const fresh = yield* readMetadataLogContext(client, config.serverId, message.author.id, channelId, true)
        if (!fresh.privateRead) return yield* Effect.fail(new MetadataLogHandlingError({ stage: "private" }))
        // Reports go to the private DM, which accepts only the fixed !
        const send = (content: string) => Effect.gen(function* () {
            if (config.scope?.mode === "multi") content = serverReply(content, config.serverId)
            // Finite backend pages and fixed local summaries bound the number of sends.
            if (content.length > 32000) return yield* Effect.fail(new MetadataLogHandlingError({ stage: "response" }))
            for (let offset = 0; offset < content.length; offset += 1900) yield* client.messages.send(channelId, { content: content.slice(offset, offset + 1900), allowedMentions: noMentions }, { timeoutMs: 5000 })
        })
        const list = `!logs${serverOption(config)} events list`, key = pageKey(config.serverId, message, "logs", "events")
        const before = operation.type === "list" && next ? nextPosition<number>(key) : undefined
        if (operation.type === "list" && next && before === undefined) { yield* send(noNextPage(list)); return }
        const result = yield* store.query({ serverId: config.serverId, context: fresh.context, privateRead: fresh.privateRead, operation: before ? { type: "list", beforeRecordNo: before } : operation }).pipe(
            Effect.catch(() => send("Backend read failed. Check backend availability and the configured bot service credentials privately, then retry this read").pipe(Effect.as(undefined))))
        if (!result) return
        if (result.type === "counters") { yield* send(counterDetail(result.counters)); return }
        if (result.type === "settings") {
            // A small destination check: the bot's fresh permissions in each enabled destination
            const destinations = [...new Set([...result.settings.routes, ...result.settings.eventRoutes].flatMap(r => r.enabled && r.channelId ? [r.channelId] : []))]
            const lines = [metadataLogSettingsDetail(result.settings)]
            for (const destination of destinations) {
                const evidence = yield* readMetadataDestinationEvidence(client, config.serverId, message.author.id, destination).pipe(Effect.catch(() => Effect.succeed(undefined)))
                lines.push(evidence ? `Destination ${destination}: Bot View ${evidence.permissions.view}, Send ${evidence.permissions.send}, Embed ${evidence.permissions.embed}` : `Destination ${destination}: Permission check unavailable`)
            }
            yield* send(lines.join("\n")); return
        }
        if (result.type === "record") { yield* send(recordDetail(result.record)); return }
        if (result.type === "records") {
            rememberPosition(key, result.nextBeforeRecordNo)
            yield* send([result.records.map(recordDetail).join("\n") || "No retained metadata observations", ...(result.nextBeforeRecordNo ? [`Next: ${list} next`] : [])].join("\n")); return
        }
    })
}

export function handleMetadataLogCommand(store: MetadataLogsStore, config: BotConfig, command: MetadataLogParse, context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void> }) {
    return Effect.gen(function* () {
        const { message, client } = context
        if (message.guildId !== undefined && message.guildId !== config.serverId) return
        if ("error" in command || command.type === "help") { yield* context.reply({ content: "error" in command ? command.error : withPrefix(serverCommands(metadataLogHelp, config), replyPrefix(config.serverId, context.message.guildId)), allowedMentions: noMentions }); return }
        if (command.type === "query") { yield* handleMetadataPrivateReport(store, config, command.operation, context, command.next); return }
        if (message.guildId === undefined) return
        yield* manageMetadataLogs(store, config, command, context, worker)
    })
}

/** A change from a server channel. A failed write is answered here, since nothing else replies to it */
function manageMetadataLogs(store: MetadataLogsStore, config: BotConfig, command: Exclude<MetadataLogParse, { error: string } | { type: "help" } | { type: "query" }>, context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void> }) {
    const reply = (content: string) => context.reply({ content: withPrefix(content, replyPrefix(config.serverId, context.message.guildId)), allowedMentions: noMentions })
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
        const content = result.duplicate ? "This metadata operation was already recorded. Read current status before another change" : result.type === "settings" ? metadataLogSettingsDetail(result.settings) : result.type === "forgotten" ? `Forgot settled metadata record ${result.recordNo}. Native messages remain` : `Reconciliation recorded ${result.recorded}. Historical delivery outcome remains ${result.record.delivery?.state ?? "Unbound"}`
        for (let offset = 0; offset < content.length; offset += 1900) yield* context.reply({ content: content.slice(offset, offset + 1900), allowedMentions: noMentions })
    }).pipe(Effect.catch(error => reply(error instanceof MetadataLogsStoreError
        ? error.status === 409 ? "Metadata log settings changed while this command ran. Check !logs metadata status, then send the command again"
            : error.status === 403 ? "Metadata log change denied by current permissions or policy" : "The metadata log change was not confirmed. Check !logs metadata status before another change"
        : "Current permissions, the destination or the record could not be verified. Nothing was changed").pipe(Effect.asVoid)))
}
