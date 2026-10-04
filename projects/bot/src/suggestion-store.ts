import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { publishingGrantSchema, publishingPostSchema, publishingGrantFields, publishingSuggestionBindingFields, publishingSuggestionConsumerSchema } from "./publishing-store.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(n => Number.isSafeInteger(n) && n >= min && n <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.makeFilter(v => /^[a-zA-Z0-9_-]{1,128}$/.test(v)))
const optional = Schema.optionalKey
const state = Schema.Literals(["under-review", "planned", "completed", "declined", "withdrawn"])
const boundedText = (max: number) => Schema.String.check(Schema.makeFilter(v => v.trim().length > 0 && v.length <= max))
const settings = Schema.Struct({ enabled: Schema.Boolean, revision: integer(1), channelId: optional(id), suggestions: integer(0, 1000), voters: integer(0, 10000), staffReceipts: integer(0, 1000), memberReceipts: integer(0, 10000), dirty: integer(0, 1000), blocked: integer(0, 1000) }).check(Schema.makeFilter(v => v.dirty <= v.suggestions && v.blocked <= v.suggestions))
export const suggestionDefinitionSchema = Schema.Struct({ suggestionNo: integer(1), revision: integer(1), authorId: id, channelId: id, text: boundedText(2000), state,
    up: integer(0, 1000), down: integer(0, 1000), voters: integer(0, 1000), desiredRevision: integer(1), publishedRevision: integer(), cardGeneration: integer(1),
    cardState: Schema.Literals(["queued", "reserved", "current", "blocked"]), cardStale: Schema.Boolean, createdAt: integer(), updatedAt: integer(),
    reason: optional(boundedText(500)), statusBy: optional(id), statusAt: optional(integer()), historyExpiresAt: optional(integer()), forgetting: Schema.Boolean, postNo: optional(integer(1)), attemptId: optional(key),
}).check(Schema.makeFilter(v => v.up + v.down <= v.voters && v.publishedRevision <= v.desiredRevision && (v.postNo === undefined) === (v.attemptId === undefined)))
const vote = Schema.Struct({ choice: Schema.Literals(["up", "down", "clear"]), joinedAt: Schema.String.check(Schema.makeFilter(v => v.length <= 64 && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)))), acceptedCreatedAt: integer(), acceptedMessageId: id })
const list = <A>(schema: Schema.Codec<A>, max = 20) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(max))
const nullableVote = Schema.NullOr(vote)
const suggestion = suggestionDefinitionSchema
const manage = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("suggestion"), suggestion }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconciled"), recorded: Schema.Boolean, suggestion, post: publishingPostSchema }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), suggestionNo: integer(1), revision: integer(1), complete: Schema.Boolean, removed: integer() })])
const query = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings }), Schema.Struct({ type: Schema.Literal("suggestion"), suggestion }),
    Schema.Struct({ type: Schema.Literal("suggestions"), suggestions: list(suggestion, 10), nextBeforeSuggestionNo: optional(integer(1)) }),
    Schema.Struct({ type: Schema.Literal("vote"), vote: nullableVote, suggestion }),
    Schema.Struct({ type: Schema.Literal("publication"), suggestion, post: Schema.NullOr(publishingPostSchema) })])
const member = Schema.Union([Schema.Struct({ duplicate: Schema.Boolean, type: Schema.Literal("suggestion"), suggestion }), Schema.Struct({ duplicate: Schema.Boolean, type: Schema.Literal("vote"), accepted: Schema.Boolean, vote: nullableVote, suggestion })])
export const suggestionWorkRowSchema = Schema.Struct({ ...publishingSuggestionBindingFields, channelId: id, dueAt: integer(), nextCheckAt: integer(), state: Schema.Literals(["queued", "reserved", "blocked"]), postNo: optional(integer(1)), attemptId: optional(key) }).check(Schema.makeFilter(v => (v.postNo === undefined) === (v.attemptId === undefined) && (v.state !== "reserved" || v.postNo !== undefined)))
const grant = Schema.Struct({ ...publishingGrantFields, source: publishingSuggestionConsumerSchema, provenance: publishingSuggestionConsumerSchema, consumer: publishingSuggestionConsumerSchema }).check(Schema.makeFilter(v => { try { Schema.decodeUnknownSync(publishingGrantSchema, { onExcessProperty: "error" })(v); return true } catch { return false } }))
const work = Schema.Union([Schema.Struct({ type: Schema.Literal("cards"), cards: list(suggestionWorkRowSchema), hasMore: Schema.Boolean, nextCursor: optional(Schema.Struct({ cursor: boundedText(4096), throughAt: integer() })) }), Schema.Struct({ type: Schema.Literal("reserved"), grant }), Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean })])
export const suggestionCardBinding = (row: C.SuggestionsCardBinding): C.SuggestionsCardBinding => ({ suggestionNo: row.suggestionNo, cardGeneration: row.cardGeneration, desiredRevision: row.desiredRevision })
export const sameSuggestionBinding = (a: C.SuggestionsCardBinding, b: C.SuggestionsCardBinding) => a.suggestionNo === b.suggestionNo && a.cardGeneration === b.cardGeneration && a.desiredRevision === b.desiredRevision
export class SuggestionsStoreError extends Data.TaggedError("SuggestionsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface SuggestionsStore {
    manage(input: C.SuggestionsManageRequest): Effect.Effect<C.SuggestionsManageResult, SuggestionsStoreError>
    query(input: C.SuggestionsQueryRequest): Effect.Effect<C.SuggestionsQueryResult, SuggestionsStoreError>
    member(input: C.SuggestionsMemberRequest): Effect.Effect<C.SuggestionsMemberResult, SuggestionsStoreError>
    work(input: C.SuggestionsWorkRequest): Effect.Effect<C.SuggestionsWorkResult, SuggestionsStoreError>
}
export function createSuggestionsStore(config: BackendConfig): SuggestionsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (v: A) => boolean) => request(`/suggestions/${operation}`, input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.filterOrFail(matches, () => new SuggestionsStoreError({ operation, status: null })), Effect.mapError(e => new SuggestionsStoreError({ operation, status: "status" in e && typeof e.status === "number" ? e.status : null })))
    return {
        query: input => call("query", input, query, v => {
            const op = input.operation
            if (op.type === "settings") return v.type === "settings"
            if (op.type === "list") return v.type === "suggestions" && v.suggestions.every((s, i) => s.channelId === input.context.channelId && (!op.state || s.state === op.state) && s.suggestionNo < (op.beforeSuggestionNo ?? Infinity) && (i === 0 || s.suggestionNo < v.suggestions[i - 1]!.suggestionNo)) && (!v.nextBeforeSuggestionNo || v.nextBeforeSuggestionNo < (op.beforeSuggestionNo ?? Infinity) && (!v.suggestions.length || v.nextBeforeSuggestionNo <= v.suggestions.at(-1)!.suggestionNo))
            return v.type === (op.type === "show" ? "suggestion" : op.type === "mine" ? "vote" : "publication") && "suggestion" in v && v.suggestion.suggestionNo === op.suggestionNo && v.suggestion.channelId === input.context.channelId
                && (v.type !== "publication" || !v.post || v.post.consumer?.type === "suggestion-card" && v.post.consumer.suggestionNo === op.suggestionNo && v.post.consumer.cardGeneration === v.suggestion.cardGeneration && v.post.postNo === v.suggestion.postNo && v.post.channelId === v.suggestion.channelId)
        }),
        member: input => call("member", input, member, v => {
            const op = input.operation
            if (v.suggestion.channelId !== input.context.channelId) return false
            if (op.type === "submit") return v.type === "suggestion" && v.suggestion.authorId === input.context.actor.userId && v.suggestion.text === op.text
            if (v.suggestion.suggestionNo !== op.suggestionNo) return false
            if (op.type === "withdraw") return v.type === "suggestion" && v.suggestion.authorId === input.context.actor.userId && (v.duplicate || v.suggestion.state === "withdrawn" && v.suggestion.revision === op.expectedRevision + 1)
            return v.type === "vote" && (!v.accepted || v.vote !== null && v.vote.choice === op.choice && v.vote.joinedAt === input.context.member?.joinedAt
                && v.vote.acceptedCreatedAt === input.createdAt && v.vote.acceptedMessageId === input.messageId)
        }),
        manage: input => call("manage", input, manage, v => {
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
        work: input => call("work", input, work, v => {
            const op = input.operation
            if (op.type === "list") return v.type === "cards" && v.hasMore === (v.nextCursor !== undefined) && new Set(v.cards.map(c => c.suggestionNo)).size === v.cards.length && (!v.nextCursor || !op.cursor || v.nextCursor.throughAt === op.cursor.throughAt && v.nextCursor.cursor !== op.cursor.cursor)
            if (op.type === "defer") return v.type === "progress"
            return v.type === "progress" || v.type === "reserved" && sameSuggestionBinding(v.grant.consumer, op.binding) && v.grant.actorId === op.context.botId && v.grant.channelId === op.context.channelId && v.grant.botId === op.context.botId
        }),
    }
}
