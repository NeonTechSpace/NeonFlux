import type { LockdownNote, LockdownWorkOutcome, LockdownWorkRow } from "@neonflux/contracts/lockdown"
import { LOCKDOWN_CHANNEL_LIMIT, LOCKDOWN_WORK_BATCH } from "@neonflux/contracts/lockdown"
import { errors, format, type Client } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { contained } from "./contained.ts"
import { renderCard, type Card } from "./reply-style.ts"
import { serverReplyStyle } from "./general-settings.ts"
import {
    lockChannel,
    lockdownSettled,
    readLockdownFacts,
    readLockdownPlan,
    restoreChannel,
} from "./lockdown-permissions.ts"
import type { LockdownStore } from "./lockdown-store.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"
import { startSignalledWorker } from "./signalled-worker.ts"

/** A pass goes on until no channel is left, and a server holds at most this many pages of channels */
const PAGES_PER_PASS = Math.ceil(LOCKDOWN_CHANNEL_LIMIT / LOCKDOWN_WORK_BATCH) + 1

/** Each running server's lockdown, so a dashboard change wakes its worker and anti-nuke can start one */
export const lockdownRuntimes = new Map<string, LockdownRuntime>()
export type LockdownRuntime = Effect.Success<ReturnType<typeof startLockdownWorker>>

const noteCard = (note: LockdownNote): Card => ({
    title: note.kind === "started" ? "Lockdown started" : "Lockdown lifted",
    fields: [
        ...(note.by ? [["By", format.userMention(note.by)] as const] : [["By", "Anti-nuke"] as const]),
        ...(note.reason ? [["Reason", note.reason] as const] : []),
    ],
})
/** A note is sent once. One that fails is left out, since the security record and status keep the same facts */
const sendNotes = (client: Client, serverId: string, notes: readonly LockdownNote[]) =>
    Effect.forEach(
        notes,
        (note) =>
            contained(
                client.messages.send(
                    note.logChannelId,
                    { ...renderCard(noteCard(note), serverReplyStyle(serverId))[0]! },
                    { timeoutMs: 5000 },
                ),
                "A lockdown staff log note could not be sent",
            ),
        { discard: true },
    )

/**
 * Reads the channels of uncertain writes and settles them. Nothing is written, so a write that did not happen becomes failed and waits
 * for staff to repeat the command. A channel that cannot be read stays uncertain
 */
export function settleLockdown(
    store: LockdownStore,
    client: Client,
    serverId: string,
    notify: () => Effect.Effect<void>,
) {
    return Effect.gen(function* () {
        const { rows } = yield* store.work({ serverId, type: "problems" })
        if (!rows.length) return 0
        const botId = yield* readAuthenticatedBotId(client)
        const report: { channelId: string; outcome: LockdownWorkOutcome }[] = []
        for (const row of rows) {
            const read = yield* client.channels.fetch(row.channelId, { timeoutMs: 5000 }).pipe(
                Effect.map((channel) => ({ channel })),
                Effect.catch((error) => Effect.succeed({ gone: errors.isNotFound(error) })),
            )
            if ("channel" in read)
                report.push({
                    channelId: row.channelId,
                    outcome: lockdownSettled(row, read.channel, serverId, botId) ? "done" : "failed",
                })
            else if (read.gone) report.push({ channelId: row.channelId, outcome: "gone" })
        }
        if (!report.length) return 0
        const result = yield* store.work({ serverId, type: "report", rows: report })
        if (result.admitted) yield* notify()
        yield* sendNotes(client, serverId, result.notes)
        return report.length
    })
}

/** The worker of one server. The dispatcher wakes it for queued channels, so a restart in the middle of a lockdown goes on */
export function startLockdownWorker(
    store: LockdownStore,
    serverId: string,
    client: Client,
    notifyMetadata: () => Effect.Effect<void>,
) {
    return Effect.gen(function* () {
        const writeOne = (row: LockdownWorkRow, facts: Effect.Success<ReturnType<typeof readLockdownFacts>>) =>
            Effect.gen(function* () {
                const channel = facts.channels.find((item) => item.id === row.channelId)
                if (!channel) return "gone" as const
                if (!facts.canWrite) return "failed" as const
                return yield* row.phase === "lock"
                    ? lockChannel(client, serverId, facts.botId, facts.botServerPermissions, row, channel)
                    : restoreChannel(client, serverId, facts.botId, row, channel)
            })
        const pass = Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const claim = yield* store.work({ serverId, type: "claim" })
                if (claim.admitted) yield* notifyMetadata()
                yield* sendNotes(client, serverId, claim.notes)
                if (!claim.rows.length) return
                // A failed read before any write gives the claim back, since nothing was sent
                const facts = yield* readLockdownFacts(client, serverId).pipe(
                    Effect.catch(() => Effect.succeed(undefined)),
                )
                const report: { channelId: string; outcome: LockdownWorkOutcome }[] = []
                for (const row of claim.rows)
                    report.push({
                        channelId: row.channelId,
                        outcome: facts ? yield* writeOne(row, facts) : "retry",
                    })
                const reported = yield* store.work({ serverId, type: "report", rows: report })
                if (reported.admitted) yield* notifyMetadata()
                yield* sendNotes(client, serverId, reported.notes)
                if (!facts) return
            }
        })
        const { wake } = yield* startSignalledWorker(
            pass,
            Effect.logWarning("A lockdown pass stopped. Its channels stay due for the next check"),
        )
        const runtime = {
            notify: () => wake,
            settle: settleLockdown(store, client, serverId, notifyMetadata),
            /** Starts a lockdown for an anti-nuke incident. It says what happened and never throws away the incident */
            startForIncident: (incidentNo: number) =>
                Effect.gen(function* () {
                    const { plan, canWrite } = yield* readLockdownPlan(client, serverId)
                    if (!canWrite) return "failed" as const
                    const result = yield* store.auto({ serverId, incidentNo, plan })
                    if (result.admitted) yield* notifyMetadata()
                    yield* wake
                    if (result.started || result.requeued !== undefined) return "started" as const
                    return result.refused === "already-on" ? ("already-on" as const) : ("failed" as const)
                }).pipe(Effect.catch(() => Effect.succeed("failed" as const))),
        }
        lockdownRuntimes.set(serverId, runtime)
        yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
                if (lockdownRuntimes.get(serverId) === runtime) lockdownRuntimes.delete(serverId)
            }),
        )
        return runtime
    })
}
