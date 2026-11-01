import type { Client, GuildAuditLogEntryCreate, Message } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import type { MetadataLogsStore } from "./metadata-log-store.ts"
import {
    createMetadataObservationSession,
    projectMetadataEvent,
    type MetadataPrevious,
} from "./metadata-log-projector.ts"
import { createWebhookNames } from "./metadata-log-webhooks.ts"
import { COUNTER_AUDIT_REASON } from "./counter-worker.ts"
import { remember } from "./optional-work.ts"
import { messageRevisionsOf } from "./message-revisions.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"
import { readChannelParent } from "./channel-parents.ts"

/** How long gateway events skip admission after the backend answered that metadata logs, or message logging, are off, unless a logs change rechecks sooner */
export const METADATA_OFF_RECHECK_MS = 60000
/** Each server's recheck after a logs change made on the dashboard or restored from a backup, which reach the bot outside chat */
export const metadataRechecks = new Map<string, () => Effect.Effect<void>>()

/**
 * The audit entry of a counter's own rename: NeonFlux made it, under the reason only a counter's rename gives, and the name is the
 * only change. Its other renames, such as the structure editor's, stay logged. The router leaves out the channel event of the rename
 */
function ownCounterEntry(name: string, payload: unknown, botId: string | undefined) {
    if (name !== "guildAuditLogEntryCreate" || !botId) return false
    const entry = payload as GuildAuditLogEntryCreate
    return (
        entry.actionType === 11 &&
        entry.userId === botId &&
        entry.reason === COUNTER_AUDIT_REASON &&
        !!entry.changes?.length &&
        entry.changes.every((change) => change.key === "name")
    )
}

/**
 * Webhook messages wait for the server's buckets and the bill guard. Posts also wait for their own switch, which is kept in memory, so
 * while the switch is off a webhook's post costs no backend call and no read. A channel the backend answered excluded is remembered
 * until the next logs change, so a webhook there spends neither a token nor a backend call
 */
export function createMetadataGatewayAdmission(
    store: MetadataLogsStore,
    serverId: string,
    notify: () => Effect.Effect<void>,
    webhookAdmission: { posts: Effect.Effect<boolean>; edits: Effect.Effect<boolean> } = {
        posts: Effect.succeed(true),
        edits: Effect.succeed(true),
    },
    webhookNames = createWebhookNames(),
) {
    const observation = createMetadataObservationSession()
    const excludedWebhookChannels = new Map<string, true>()
    // A recheck starts a new generation, so a disabled answer to an admission sent before it cannot pause admission again
    let lastFailureAt = -Infinity,
        failures = 0,
        offUntil = 0,
        messagesOffUntil = 0,
        generation = 0,
        // The client of the last event or read, whose message memory a recheck updates
        known: Client | undefined,
        // What the last answer said of message events and webhook posts. Unknown until one answers, so a webhook's edit or
        // deletion asks once and then costs nothing while message events are not logged
        messagesLogged: boolean | undefined,
        webhookPosts = false
    // previous is what the bot last knew of a changed or deleted resource or message, so a record can name what changed
    const admit = (name: string, payload: unknown, client: Client, previous?: MetadataPrevious) =>
        Effect.gen(function* () {
            known = client
            const now = yield* Clock.currentTimeMillis
            if (now < offUntil) return
            const asked = generation
            const botId = yield* readAuthenticatedBotId(client).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (ownCounterEntry(name, payload, botId)) return
            const scope = observation(serverId, now)
            // A changed thread's tags show by name when the SDK holds its forum
            const forum =
                name === "threadUpdate" && previous
                    ? yield* client.channels.get(String((payload as { parentId?: unknown }).parentId))
                    : undefined
            const tags =
                forum && "availableTags" in forum && forum.availableTags
                    ? new Map(forum.availableTags.map((tag) => [tag.id, tag.name]))
                    : undefined
            // An audit entry about a webhook shows its name. The read this may cost happens only while logs are not known to be off
            const audit = name === "guildAuditLogEntryCreate" ? (payload as GuildAuditLogEntryCreate) : undefined
            const webhook =
                audit?.targetId && audit.actionType >= 50 && audit.actionType <= 52
                    ? yield* webhookNames.ofAudit(client, audit.targetId, audit)
                    : undefined
            const projected = projectMetadataEvent(name, payload, { ...scope, ...(botId ? { botId } : {}) }, previous, {
                ...(tags ? { tags } : {}),
                webhook,
            })
            if (
                !projected ||
                (projected.category === "messages" &&
                    (now < messagesOffUntil ||
                        (projected.type.startsWith("webhook-message-") && messagesLogged === false)))
            )
                return
            const webhookKey = projected.type.startsWith("webhook-message-")
                ? `${projected.type}:${projected.channelId}`
                : undefined
            if (webhookKey) {
                if (excludedWebhookChannels.has(webhookKey)) return
                const allowed = yield* projected.type === "webhook-message-create"
                    ? webhookAdmission.posts
                    : webhookAdmission.edits
                if (!allowed) return
            }
            // Message rules treat a thread as its parent channel too. Only an admissible message event costs a lookup
            const parentChannelId =
                projected.category === "messages" && projected.channelId
                    ? yield* readChannelParent(client, projected.channelId)
                    : undefined
            const event = parentChannelId ? { ...projected, parentChannelId } : projected
            const result = yield* store.admit({ serverId, event })
            // The process keeps this server's message text only while its message events reach a log channel, which
            // an admitted message event proves. An answer to an admission sent before a later recheck says nothing about
            // the settings the recheck follows, so it leaves the memory to the recheck's read
            const memory = messageRevisionsOf(client)
            if (result.admitted) {
                if (event.category === "messages") {
                    if (asked === generation) {
                        memory.keepText(serverId, true)
                        messagesLogged = true
                    }
                    // The router noted this edit before the answer, so the memory now keeps its text for the next one
                    // while it keeps the server's text
                    if (name === "messageUpdate") memory.created(payload as Message)
                }
                yield* notify()
            } else if (webhookKey && result.reason === "excluded" && asked === generation) {
                remember(excludedWebhookChannels, webhookKey, true)
            } else if ((result.reason === "disabled" || result.reason === "messages-off") && asked === generation) {
                memory.keepText(serverId, false)
                messagesLogged = false
                if (result.reason === "disabled") offUntil = now + METADATA_OFF_RECHECK_MS
                else messagesOffUntil = now + METADATA_OFF_RECHECK_MS
            }
        }).pipe(
            Effect.catchCause((cause) => {
                if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
                return Effect.gen(function* () {
                    failures++
                    const now = yield* Clock.currentTimeMillis
                    if (now - lastFailureAt < 60000) return
                    lastFailureAt = now
                    const count = failures
                    failures = 0
                    const scope = observation(serverId, now)
                    yield* store
                        .admit({
                            serverId,
                            event: {
                                originServerId: serverId,
                                category: "operations",
                                type: "admission-failure",
                                source: { kind: "observation", sessionId: scope.sessionId, sequence: scope.sequence },
                                observedAt: now,
                                actor: { kind: "unknown" },
                                resourceIds: [],
                                changedFields: [],
                                count,
                                outcome: "failed",
                            },
                        })
                        .pipe(Effect.catch(() => Effect.void))
                })
            }),
        )
    // The backend says whether this server's message events reach a log channel, and the memory keeps or forgets the
    // server's message text by that answer. An answer to a read sent before a later recheck says nothing about the settings
    // the recheck follows, so only the latest read decides
    const readMessages = (client: Client, failed: "forget" | "keep") =>
        Effect.gen(function* () {
            known = client
            const asked = generation
            const result = yield* store
                .work({ serverId, operation: { type: "messages" } })
                .pipe(Effect.catchCause((cause) => (Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.void)))
            if (asked !== generation) return
            if (result?.type === "messages") {
                messageRevisionsOf(client).keepText(serverId, result.logged)
                messagesLogged = result.logged
                webhookPosts = result.webhookPosts
            } else if (failed === "forget") messageRevisionsOf(client).keepText(serverId, false)
        })
    return Object.assign(admit, {
        /** What a webhook posted, when its switch is on. The bucket and the bill guard are asked with the other webhook events */
        webhookPost: (message: Message, client: Client) =>
            Effect.suspend(() =>
                !webhookPosts || messagesLogged === false ? Effect.void : admit("messageCreate", message, client),
            ),
        // At a server's start the first edit already shows its earlier text where message events are logged. A failed
        // read keeps nothing, and the first admitted message event starts keeping it
        start: (client: Client) => readMessages(client, "forget"),
        // A logs change ends the pauses at once and asks the backend again whether message events are logged. Text kept
        // before stays unless the answer says they are not, and a failed read changes nothing
        recheck: () =>
            Effect.suspend(() => {
                offUntil = 0
                messagesOffUntil = 0
                generation++
                excludedWebhookChannels.clear()
                return known ? readMessages(known, "keep") : Effect.void
            }),
    })
}
