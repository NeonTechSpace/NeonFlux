import type { SuggestionsWorkCursor } from "@neonflux/contracts/suggestions"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Queue } from "effect"
import { suggestionCardBinding, type SuggestionsStore } from "./suggestion-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { processSuggestionCard, SuggestionsHandlingError } from "./suggestions.ts"

export const suggestionsPassBudget = 20
export function processSuggestionsPass(store: SuggestionsStore, publishing: PublishingStore, serverId: string, client: Client, cursor?: SuggestionsWorkCursor) {
    return Effect.gen(function* () {
        const page = yield* store.work({ serverId, operation: { type: "list", ...(cursor ? { cursor } : {}) } })
        if (page.type !== "cards" || page.cards.length > suggestionsPassBudget) return yield* Effect.fail(new SuggestionsHandlingError({ stage: "response" }))
        for (const card of page.cards) yield* processSuggestionCard(store, publishing, serverId, client, card).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
            : store.work({ serverId, operation: { type: "defer", binding: suggestionCardBinding(card) } }).pipe(Effect.catch(() => Effect.void))))
        return { considered: page.cards.length, hasMore: page.hasMore, nextCursor: page.nextCursor }
    })
}
export function startSuggestionsWorker(store: SuggestionsStore, publishing: PublishingStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" })
        const scope = yield* Effect.scope
        const wake = () => Queue.offer(queue, undefined).pipe(Effect.asVoid)
        let cursor: SuggestionsWorkCursor | undefined
        // Delay the first command wake once. Later commands cannot push this deadline forward.
        let pendingWake = false
        const notify = () => Effect.gen(function* () {
            if (pendingWake) return
            pendingWake = true
            yield* Effect.sleep("5 seconds").pipe(Effect.andThen(Effect.sync(() => { pendingWake = false })), Effect.andThen(wake()), Effect.forkIn(scope, { startImmediately: true }))
        })
        yield* Effect.gen(function* () { for (;;) {
            yield* Queue.take(queue)
            yield* processSuggestionsPass(store, publishing, serverId, client, cursor).pipe(Effect.tap(result => Effect.gen(function* () {
                cursor = result.nextCursor
                if (result.hasMore) yield* wake()
            })), Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Suggestion card work paused. Inspect publication status for exact recovery")))
        } }).pipe(Effect.forkScoped({ startImmediately: true }))
        // Commands use the delayed notify. The work dispatcher wakes the worker at once when a card of this server is due
        return { notify, wake }
    })
}
