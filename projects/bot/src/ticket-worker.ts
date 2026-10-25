import type { Client } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { TicketStore } from "./ticket-store.ts"
import { saveTicketTranscript } from "./ticket-transcripts.ts"
import { startSignalledWorker } from "./signalled-worker.ts"
import { warnFailure } from "./contained.ts"

// The backend lists at most this many due tickets per pass, so a full list runs another pass
const duePage = 10

/** One work pass: each due ticket transcript is brought up to date, and a failed read retries on the backend's schedule */
export function processTicketPass(store: TicketStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const work = yield* store.work({ serverId, operation: { type: "due" } })
        if (work.type !== "due") return { more: false }
        for (const due of work.tickets) {
            const outcome = yield* saveTicketTranscript(store, client, serverId, due).pipe(
                Effect.catch((error) =>
                    warnFailure(
                        "A ticket transcript could not be saved. NeonFlux tries again every 10 minutes, at most six times in all",
                        error,
                    ).pipe(Effect.as("failed" as const)),
                ),
            )
            yield* store.transcriptDone({ serverId, ticketNo: due.ticketNo, dueAt: due.dueAt, outcome })
        }
        return { more: work.tickets.length >= duePage }
    })
}

export function startTicketWorker(store: TicketStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const { wake } = yield* startSignalledWorker(
            processTicketPass(store, serverId, client),
            Effect.logWarning("Ticket transcript work paused until the backend answers"),
            (result, again) => (result.more ? again : Effect.void),
        )
        // The work dispatcher wakes this worker when a ticket transcript of this server is due
        return { notify: () => wake }
    })
}
