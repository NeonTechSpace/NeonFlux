import type { SuggestionsCardBinding } from "@neonflux/contracts/publishing-base"
import { SuggestionsManageResult, SuggestionsQueryResult, SuggestionsMemberResult, SuggestionsWorkResult, type SuggestionsManageRequest, type SuggestionsQueryRequest, type SuggestionsMemberRequest, type SuggestionsWorkRequest } from "@neonflux/contracts/suggestions"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export const suggestionCardBinding = (row: SuggestionsCardBinding): SuggestionsCardBinding => ({ suggestionNo: row.suggestionNo, cardGeneration: row.cardGeneration, desiredRevision: row.desiredRevision })
export const sameSuggestionBinding = (a: SuggestionsCardBinding, b: SuggestionsCardBinding) => a.suggestionNo === b.suggestionNo && a.cardGeneration === b.cardGeneration && a.desiredRevision === b.desiredRevision
export class SuggestionsStoreError extends Data.TaggedError("SuggestionsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface SuggestionsStore {
    manage(input: SuggestionsManageRequest): Effect.Effect<SuggestionsManageResult, SuggestionsStoreError>
    query(input: SuggestionsQueryRequest): Effect.Effect<SuggestionsQueryResult, SuggestionsStoreError>
    member(input: SuggestionsMemberRequest): Effect.Effect<SuggestionsMemberResult, SuggestionsStoreError>
    work(input: SuggestionsWorkRequest): Effect.Effect<SuggestionsWorkResult, SuggestionsStoreError>
}
export function createSuggestionsStore(config: BackendConfig): SuggestionsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (v: A) => boolean) => request(`/suggestions/${operation}`, input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.filterOrFail(matches, () => new SuggestionsStoreError({ operation, status: null })), Effect.mapError(e => new SuggestionsStoreError({ operation, status: "status" in e && typeof e.status === "number" ? e.status : null })))
    return {
        query: input => call("query", input, SuggestionsQueryResult, v => {
            const op = input.operation
            if (op.type === "settings") return v.type === "settings"
            if (op.type === "list") return v.type === "suggestions" && v.suggestions.every((s, i) => s.channelId === input.context.channelId && (!op.state || s.state === op.state) && s.suggestionNo < (op.beforeSuggestionNo ?? Infinity) && (i === 0 || s.suggestionNo < v.suggestions[i - 1]!.suggestionNo)) && (!v.nextBeforeSuggestionNo || v.nextBeforeSuggestionNo < (op.beforeSuggestionNo ?? Infinity) && (!v.suggestions.length || v.nextBeforeSuggestionNo <= v.suggestions.at(-1)!.suggestionNo))
            return v.type === (op.type === "show" ? "suggestion" : op.type === "mine" ? "vote" : "publication") && "suggestion" in v && v.suggestion.suggestionNo === op.suggestionNo && v.suggestion.channelId === input.context.channelId
                && (v.type !== "publication" || !v.post || v.post.consumer?.type === "suggestion-card" && v.post.consumer.suggestionNo === op.suggestionNo && v.post.consumer.cardGeneration === v.suggestion.cardGeneration && v.post.postNo === v.suggestion.postNo && v.post.channelId === v.suggestion.channelId)
        }),
        member: input => call("member", input, SuggestionsMemberResult, v => {
            const op = input.operation
            if (v.suggestion.channelId !== input.context.channelId) return false
            if (op.type === "submit") return v.type === "suggestion" && v.suggestion.authorId === input.context.actor.userId && v.suggestion.text === op.text
            if (v.suggestion.suggestionNo !== op.suggestionNo) return false
            if (op.type === "withdraw") return v.type === "suggestion" && v.suggestion.authorId === input.context.actor.userId && (v.duplicate || v.suggestion.state === "withdrawn" && v.suggestion.revision === op.expectedRevision + 1)
            return v.type === "vote" && (!v.accepted || v.vote !== null && v.vote.choice === op.choice && v.vote.joinedAt === input.context.member?.joinedAt
                && v.vote.acceptedCreatedAt === input.createdAt && v.vote.acceptedMessageId === input.messageId)
        }),
        manage: input => call("manage", input, SuggestionsManageResult, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "settings" || op.type === "configure") return v.type === "settings" && v.settings.revision === op.expectedRevision + 1 && (op.type === "settings" ? v.settings.enabled === op.enabled : v.settings.channelId === op.channelId)
            if (op.type === "forget") return v.type === "forgotten" && v.suggestionNo === op.suggestionNo && v.revision >= op.expectedRevision
            if (!("suggestion" in v) || v.suggestion.suggestionNo !== op.suggestionNo || v.suggestion.channelId !== input.context.channelId) return false
            if (op.type === "reconcile") return v.type === "reconciled" && v.post.postNo === op.postNo && v.post.generation === op.expectedGeneration && v.post.attempt.attemptId === op.attemptId && v.post.consumer?.type === "suggestion-card" && v.post.consumer.suggestionNo === op.suggestionNo && v.post.consumer.cardGeneration === op.cardGeneration && v.post.messageId === op.observation.messageId && v.post.channelId === op.observation.channelId && v.post.botId === op.observation.botId
            if (v.type !== "suggestion" || v.suggestion.revision !== op.expectedRevision + 1) return false
            if (op.type === "status") return v.suggestion.state === op.state && v.suggestion.reason === op.reason && v.suggestion.statusBy === input.context.actor.userId
            return v.suggestion.cardGeneration === op.cardGeneration + 1 && v.suggestion.cardState === "queued"
        }),
        work: input => call("work", input, SuggestionsWorkResult, v => {
            const op = input.operation
            if (op.type === "list") return v.type === "cards" && v.hasMore === (v.nextCursor !== undefined) && new Set(v.cards.map(c => c.suggestionNo)).size === v.cards.length && (!v.nextCursor || !op.cursor || v.nextCursor.throughAt === op.cursor.throughAt && v.nextCursor.cursor !== op.cursor.cursor)
            if (op.type === "defer") return v.type === "progress"
            return v.type === "progress" || v.type === "reserved" && sameSuggestionBinding(v.grant.consumer, op.binding) && v.grant.actorId === op.context.botId && v.grant.channelId === op.context.channelId && v.grant.botId === op.context.botId
        }),
    }
}
