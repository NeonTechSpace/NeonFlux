import type { SuggestionsWorkRow } from "@neonflux/contracts/suggestions"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { sameSuggestionBinding, suggestionCardBinding, type SuggestionsStore } from "./suggestion-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { readSuggestionCardContext } from "./suggestion-permissions.ts"
import { performPublishingGrant } from "./publishing.ts"
import { prepareSuggestionPost, SuggestionTagError } from "./suggestion-forum.ts"
import { forgetSuggestionCards, seedSuggestionReactions } from "./suggestion-reactions.ts"
import { warnFailure } from "./contained.ts"

export class SuggestionsHandlingError extends Data.TaggedError("SuggestionsHandlingError")<{
    readonly stage: "response" | "grant" | "identity"
}> {}
export function processSuggestionCard(
    store: SuggestionsStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
    card: SuggestionsWorkRow,
) {
    return Effect.gen(function* () {
        // Returned rows are admitted work. nextCheckAt is future rescan metadata, not a dispatch gate.
        if (card.dueAt > (yield* Clock.currentTimeMillis)) return
        // The card lives in the destination, or in its own post when the destination is a forum
        const cardChannel = card.threadId ?? card.channelId
        const appliedTagIds = yield* prepareSuggestionPost(client, card).pipe(
            Effect.tapError((error) =>
                error instanceof SuggestionTagError
                    ? warnFailure(`Suggestion ${card.suggestionNo} card waits: ${error.fix}`, error.cause ?? error)
                    : Effect.void,
            ),
        )
        const fresh = () => readSuggestionCardContext(client, serverId, cardChannel)
        const result = yield* store.work({
            serverId,
            operation: { type: "reserve", binding: suggestionCardBinding(card), context: yield* fresh() },
        })
        if (result.type === "progress") return
        if (result.type !== "reserved") return yield* Effect.fail(new SuggestionsHandlingError({ stage: "response" }))
        const grant = result.grant,
            now = yield* Clock.currentTimeMillis
        if (
            !sameSuggestionBinding(grant.consumer, card) ||
            !sameSuggestionBinding(grant.source, card) ||
            !sameSuggestionBinding(grant.provenance, card) ||
            grant.source.type !== "suggestion-card" ||
            grant.provenance.type !== "suggestion-card" ||
            grant.consumer.type !== "suggestion-card" ||
            grant.actorId !== grant.botId ||
            grant.channelId !== cardChannel ||
            grant.dispatchExpiresAt > now + 180000 ||
            grant.dispatchExpiresAt <= now ||
            grant.sourceId !==
                `suggestion_${card.suggestionNo}_${card.cardGeneration}_${card.desiredRevision}_${grant.generation}` ||
            grant.nativeDeadlineMs !== 5000 ||
            (card.state === "reserved" && (grant.postNo !== card.postNo || grant.attemptId !== card.attemptId))
        )
            return yield* Effect.fail(new SuggestionsHandlingError({ stage: "grant" }))
        const delivered = yield* performPublishingGrant(
            publishing,
            serverId,
            grant.botId,
            client,
            grant,
            fresh,
            undefined,
            undefined,
            appliedTagIds,
        )
        // A new card offers its two vote reactions, in the forum post that holds it when there is one. Edits add nothing
        if (grant.action === "send" && delivered.outcome === "sent" && delivered.messageId) {
            yield* seedSuggestionReactions(client, {
                id: delivered.messageId,
                channelId: delivered.threadId ?? grant.channelId,
            })
            forgetSuggestionCards(client, serverId)
        }
        return delivered
    })
}
