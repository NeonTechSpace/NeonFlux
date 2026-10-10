import { Schema } from "effect"
import { Id, Int, List, Millis, Str, Text, Token, origin } from "./common.ts"
import { ModerationSource } from "./shared.ts"
import { PublishingGrant, PublishingObservation, PublishingPost, PublishingSuggestionConsumer, SuggestionsCardBinding, publishingGrantFields } from "./publishing-base.ts"
import { EventsContext } from "./events.ts"

export const SUGGESTIONS_DAY = 86400000, SUGGESTIONS_BATCH = 20
const optional = Schema.optionalKey
const boundedText = (max: number) => Str(max).check(Schema.makeFilter(value => value.trim().length > 0))
export const SuggestionsState = Schema.Literals(["under-review", "planned", "completed", "declined", "withdrawn"])
export type SuggestionsState = typeof SuggestionsState.Type
const state = SuggestionsState
export const SuggestionsVoteChoice = Schema.Literals(["up", "down", "clear"])
export type SuggestionsVoteChoice = typeof SuggestionsVoteChoice.Type
export const SuggestionsWorkCursor = Schema.Struct({ cursor: Str(4096).check(Schema.isMinLength(1)), throughAt: Millis })
export type SuggestionsWorkCursor = typeof SuggestionsWorkCursor.Type
export const SuggestionsSettings = Schema.Struct({ enabled: Schema.Boolean, revision: Int(1), channelId: optional(Id), suggestions: Int(0, 1000), voters: Int(0, 10000), staffReceipts: Int(0, 1000), memberReceipts: Int(0, 10000), dirty: Int(0, 1000), blocked: Int(0, 1000) }).check(Schema.makeFilter(v => v.dirty <= v.suggestions && v.blocked <= v.suggestions))
export type SuggestionsSettings = typeof SuggestionsSettings.Type
export const SuggestionsDefinition = Schema.Struct({ suggestionNo: Int(1), revision: Int(1), authorId: Id, channelId: Id, text: boundedText(2000), state,
    up: Int(0, 1000), down: Int(0, 1000), voters: Int(0, 1000), desiredRevision: Int(1), publishedRevision: Int(), cardGeneration: Int(1),
    cardState: Schema.Literals(["queued", "reserved", "current", "blocked"]), cardStale: Schema.Boolean, createdAt: Int(), updatedAt: Int(),
    reason: optional(boundedText(500)), statusBy: optional(Id), statusAt: optional(Int()), historyExpiresAt: optional(Int()), forgetting: Schema.Boolean, postNo: optional(Int(1)), attemptId: optional(Token), threadId: optional(Id),
}).check(Schema.makeFilter(v => v.up + v.down <= v.voters && v.publishedRevision <= v.desiredRevision && (v.postNo === undefined) === (v.attemptId === undefined)))
export type SuggestionsDefinition = typeof SuggestionsDefinition.Type
export const SuggestionsVote = Schema.Struct({ choice: SuggestionsVoteChoice, joinedAt: Schema.String.check(Schema.makeFilter(v => v.length <= 64 && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)))), acceptedCreatedAt: Int(), acceptedMessageId: Id })
export type SuggestionsVote = typeof SuggestionsVote.Type
const nullableVote = Schema.NullOr(SuggestionsVote)
const suggestion = SuggestionsDefinition
export const SuggestionsManageResult = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: SuggestionsSettings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("suggestion"), suggestion }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconciled"), recorded: Schema.Boolean, suggestion, post: PublishingPost }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), suggestionNo: Int(1), revision: Int(1), complete: Schema.Boolean, removed: Int() })])
export type SuggestionsManageResult = typeof SuggestionsManageResult.Type
export const SuggestionsQueryResult = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings: SuggestionsSettings }), Schema.Struct({ type: Schema.Literal("suggestion"), suggestion }),
    Schema.Struct({ type: Schema.Literal("suggestions"), suggestions: List(suggestion, 10), nextBeforeSuggestionNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("vote"), vote: nullableVote, suggestion }),
    Schema.Struct({ type: Schema.Literal("publication"), suggestion, post: Schema.NullOr(PublishingPost) })])
export type SuggestionsQueryResult = typeof SuggestionsQueryResult.Type
export const SuggestionsMemberResult = Schema.Union([Schema.Struct({ duplicate: Schema.Boolean, type: Schema.Literal("suggestion"), suggestion }), Schema.Struct({ duplicate: Schema.Boolean, type: Schema.Literal("vote"), accepted: Schema.Boolean, vote: nullableVote, suggestion })])
export type SuggestionsMemberResult = typeof SuggestionsMemberResult.Type
/** channelId is the destination and threadId the forum post that holds the card once it exists. suggestionState selects the post's status tag */
export const SuggestionsWorkRow = Schema.Struct({ ...SuggestionsCardBinding.fields, channelId: Id, threadId: optional(Id), suggestionState: state, dueAt: Int(), nextCheckAt: Int(), state: Schema.Literals(["queued", "reserved", "blocked"]), postNo: optional(Int(1)), attemptId: optional(Token) }).check(Schema.makeFilter(v => (v.postNo === undefined) === (v.attemptId === undefined) && (v.state !== "reserved" || v.postNo !== undefined)))
export type SuggestionsWorkRow = typeof SuggestionsWorkRow.Type
export const SuggestionsCardGrant = Schema.Struct({ ...publishingGrantFields, source: PublishingSuggestionConsumer, provenance: PublishingSuggestionConsumer, consumer: PublishingSuggestionConsumer }).check(Schema.makeFilter(Schema.is(PublishingGrant)))
export type SuggestionsCardGrant = typeof SuggestionsCardGrant.Type
export const SuggestionsWorkResult = Schema.Union([Schema.Struct({ type: Schema.Literal("cards"), cards: List(SuggestionsWorkRow, SUGGESTIONS_BATCH), hasMore: Schema.Boolean, nextCursor: optional(SuggestionsWorkCursor.check(Schema.makeFilter(v => v.cursor.trim().length > 0))) }), Schema.Struct({ type: Schema.Literal("reserved"), grant: SuggestionsCardGrant }), Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean })])
export type SuggestionsWorkResult = typeof SuggestionsWorkResult.Type
export const SuggestionsContext = EventsContext
export type SuggestionsContext = typeof SuggestionsContext.Type
export const SuggestionsCardContext = Schema.Struct({ ...origin, observedAt: Millis, channelId: Id, botId: Id, botAuthorized: Schema.Literal(true) })
export type SuggestionsCardContext = typeof SuggestionsCardContext.Type
export const SuggestionsPostBinding = Schema.Struct({ suggestionNo: Int(1), expectedRevision: Int(1), cardGeneration: Int(1), postNo: Int(1), attemptId: Token, expectedGeneration: Int(1) })
export type SuggestionsPostBinding = typeof SuggestionsPostBinding.Type
export const SuggestionsMissingObservation = Schema.Struct({ ...origin, status: Schema.Literal("absent"), observedAt: Millis, messageId: Id, channelId: Id, botId: Id })
export type SuggestionsMissingObservation = typeof SuggestionsMissingObservation.Type
export const SuggestionsManageOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("configure"), expectedRevision: Int(1), channelId: Id }),
    Schema.Struct({ type: Schema.Literal("settings"), expectedRevision: Int(1), enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("status"), suggestionNo: Int(1), expectedRevision: Int(1), state: Schema.Literals(["under-review", "planned", "completed", "declined"]), reason: Text(500) }),
    Schema.Struct({ type: Schema.Literal("reconcile"), observation: PublishingObservation, ...SuggestionsPostBinding.fields }),
    Schema.Struct({ type: Schema.Literal("replace"), observation: SuggestionsMissingObservation, confirm: Schema.Literal(true), ...SuggestionsPostBinding.fields }),
    Schema.Struct({ type: Schema.Literal("forget"), suggestionNo: Int(1), expectedRevision: Int(1), confirm: Schema.Literal(true) }),
])
export type SuggestionsManageOperation = typeof SuggestionsManageOperation.Type
const source = { ...ModerationSource.fields, serverId: Id, context: SuggestionsContext }
export const SuggestionsManageRequest = Schema.Struct({ ...source, operation: SuggestionsManageOperation })
export type SuggestionsManageRequest = typeof SuggestionsManageRequest.Type
export const SuggestionsMemberRequest = Schema.Struct({ ...source, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("submit"), text: Text(2000) }),
    Schema.Struct({ type: Schema.Literal("vote"), suggestionNo: Int(1), choice: SuggestionsVoteChoice }),
    Schema.Struct({ type: Schema.Literal("withdraw"), suggestionNo: Int(1), expectedRevision: Int(1), confirm: Schema.Literal(true) }),
]) })
export type SuggestionsMemberRequest = typeof SuggestionsMemberRequest.Type
export const SuggestionsQueryRequest = Schema.Struct({ serverId: Id, context: SuggestionsContext, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings") }),
    Schema.Struct({ type: Schema.Literals(["show", "mine", "publication"]), suggestionNo: Int(1) }),
    Schema.Struct({ type: Schema.Literal("list"), state: optional(SuggestionsState), beforeSuggestionNo: optional(Int(1)) }),
]) })
export type SuggestionsQueryRequest = typeof SuggestionsQueryRequest.Type
export const SuggestionsWorkRequest = Schema.Struct({ serverId: Id, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("list"), cursor: optional(SuggestionsWorkCursor) }),
    Schema.Struct({ type: Schema.Literal("reserve"), binding: SuggestionsCardBinding, context: SuggestionsCardContext }),
    Schema.Struct({ type: Schema.Literal("defer"), binding: SuggestionsCardBinding }),
]) })
export type SuggestionsWorkRequest = typeof SuggestionsWorkRequest.Type
