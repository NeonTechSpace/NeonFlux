import type { Client, Message } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import type { MetadataLogsStore } from "./metadata-log-store.ts"
import {
    createMetadataObservationSession,
    projectMetadataEvent,
    type MetadataPrevious,
} from "./metadata-log-projector.ts"
import { messageRevisionsOf } from "./message-revisions.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"
import { readChannelParent } from "./channel-parents.ts"

/** How long gateway events skip admission after the backend answered that metadata logs, or message logging, are off, unless a logs change rechecks sooner */
export const METADATA_OFF_RECHECK_MS = 60000
/** Each server's recheck after a logs change made on the dashboard or restored from a backup, which reach the bot outside chat */
export const metadataRechecks = new Map<string, () => Effect.Effect<void>>()

export function createMetadataGatewayAdmission(
    store: MetadataLogsStore,
    serverId: string,
    notify: () => Effect.Effect<void>,
) {
    const observation = createMetadataObservationSession()
    // A recheck starts a new generation, so a disabled answer to an admission sent before it cannot pause admission again
    let lastFailureAt = -Infinity,
        failures = 0,
        offUntil = 0,
        messagesOffUntil = 0,
        generation = 0,
        // The client of the last event or read, whose message memory a recheck updates
        known: Client | undefined
    // previous is what the bot last knew of a changed or deleted resource or message, so a record can name what changed
    const admit = (name: string, payload: unknown, client: Client, previous?: MetadataPrevious) =>
        Effect.gen(function* () {
            known = client
            const now = yield* Clock.currentTimeMillis
            if (now < offUntil) return
            const asked = generation
            const botId = yield* readAuthenticatedBotId(client).pipe(Effect.catch(() => Effect.succeed(undefined)))
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
            const projected = projectMetadataEvent(
                name,
                payload,
                { ...scope, ...(botId ? { botId } : {}) },
                previous,
                tags ? { tags } : {},
            )
            if (!projected || (projected.category === "messages" && now < messagesOffUntil)) return
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
                    if (asked === generation) memory.keepText(serverId, true)
                    // The router noted this edit before the answer, so the memory now keeps its text for the next one
                    // while it keeps the server's text
                    if (name === "messageUpdate") memory.created(payload as Message)
                }
                yield* notify()
            } else if ((result.reason === "disabled" || result.reason === "messages-off") && asked === generation) {
                memory.keepText(serverId, false)
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
            if (result?.type === "messages") messageRevisionsOf(client).keepText(serverId, result.logged)
            else if (failed === "forget") messageRevisionsOf(client).keepText(serverId, false)
        })
    return Object.assign(admit, {
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
                return known ? readMessages(known, "keep") : Effect.void
            }),
    })
}
