import type * as C from "@neonflux/backend/contracts"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { sameSuggestionBinding, suggestionCardBinding, type SuggestionsStore } from "./suggestion-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { readSuggestionCardContext } from "./suggestion-permissions.ts"
import { performPublishingGrant } from "./publishing.ts"

export class SuggestionsHandlingError extends Data.TaggedError("SuggestionsHandlingError")<{ readonly stage: "response" | "grant" | "identity" }> {}
export function processSuggestionCard(store: SuggestionsStore, publishing: PublishingStore, serverId: string, client: Client, card: C.SuggestionsWorkRow) {
    return Effect.gen(function* () {
        // Returned rows are admitted work. nextCheckAt is future rescan metadata, not a dispatch gate.
        if (card.dueAt > (yield* Clock.currentTimeMillis)) return
        const fresh = () => readSuggestionCardContext(client, serverId, card.channelId)
        const result = yield* store.work({ serverId, operation: { type: "reserve", binding: suggestionCardBinding(card), context: yield* fresh() } })
        if (result.type === "progress") return
        if (result.type !== "reserved") return yield* Effect.fail(new SuggestionsHandlingError({ stage: "response" }))
        const grant = result.grant, now = yield* Clock.currentTimeMillis
        if (!sameSuggestionBinding(grant.consumer, card) || !sameSuggestionBinding(grant.source, card) || !sameSuggestionBinding(grant.provenance, card)
            || grant.source.type !== "suggestion-card" || grant.provenance.type !== "suggestion-card" || grant.consumer.type !== "suggestion-card"
            || grant.actorId !== grant.botId || grant.channelId !== card.channelId || grant.dispatchExpiresAt > now + 180000 || grant.dispatchExpiresAt <= now
            || grant.sourceId !== `suggestion_${card.suggestionNo}_${card.cardGeneration}_${card.desiredRevision}_${grant.generation}`
            || grant.nativeDeadlineMs !== 5000 || card.state === "reserved" && (grant.postNo !== card.postNo || grant.attemptId !== card.attemptId)) return yield* Effect.fail(new SuggestionsHandlingError({ stage: "grant" }))
        return yield* performPublishingGrant(publishing, serverId, grant.botId, client, grant, fresh)
    })
}
