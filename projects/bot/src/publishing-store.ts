import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { canonicalPublishingContent, equalPublishingContent, publishingContentSchema } from "./publishing-content.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= min && n <= max))
const id = Schema.String.check(Schema.makeFilter((value) => snowflakes.isValid(value) && value !== "0"))
const key = Schema.String.check(Schema.makeFilter((value) => /^[a-zA-Z0-9_-]{1,128}$/.test(value)))
const name = Schema.String.check(Schema.makeFilter((value) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)))
const optional = Schema.optionalKey
const kind = Schema.Literals(["draft", "template"])
const outcome = Schema.Literals(["pending", "sent", "failed", "uncertain"])
const settings = Schema.Struct({ enabled: Schema.Boolean })
const content = publishingContentSchema
const canonical = (value: { content: C.PublishingContent, canonicalContent: C.PublishingContent }) => equalPublishingContent(value.canonicalContent, canonicalPublishingContent(value.content))
const draft = Schema.Struct({ kind, name, revision: integer(1), content, canonicalContent: content, createdAt: integer(), updatedAt: integer() }).check(Schema.makeFilter((value) => value.updatedAt >= value.createdAt && canonical(value)))
const observation = Schema.Struct({ observedAt: integer(), messageId: id, channelId: id, botId: id, content })
export const publishingSuggestionBindingFields = { suggestionNo: integer(1), cardGeneration: integer(1), desiredRevision: integer(1) }
export const publishingSuggestionConsumerSchema = Schema.Struct({ type: Schema.Literal("suggestion-card"), ...publishingSuggestionBindingFields })
const source = Schema.Union([
    Schema.Struct({ type: Schema.Literal("dashboard-message"), jobId: key, createdAt: integer() }),
    Schema.Struct({ type: Schema.Literal("dashboard-role"), jobId: key, createdAt: integer() }),
    Schema.Struct({ type: Schema.Literal("dashboard-configuration"), jobId: key, family: Schema.Literal("events"), createdAt: integer() }),
    publishingSuggestionConsumerSchema,
    Schema.Struct({ type: Schema.Literal("human"), messageId: id, createdAt: integer() }),
    Schema.Struct({ type: Schema.Literal("event-timer"), deliveryId: key, dueAt: integer() }),
    Schema.Struct({ type: Schema.Literal("schedule-timer"), deliveryId: key, dueAt: integer() }),
    Schema.Struct({ type: Schema.Literal("milestone-timer"), deliveryId: key, dueAt: integer() }),
])
const provenance = Schema.Union([
    Schema.Struct({ type: Schema.Literal("dashboard-message"), jobId: key }),
    Schema.Struct({ type: Schema.Literal("dashboard-role"), jobId: key, panelName: name, panelRevision: integer(1) }),
    publishingSuggestionConsumerSchema,
    Schema.Struct({ type: Schema.Literal("draft"), kind, name, revision: integer(1) }),
    Schema.Struct({ type: Schema.Literal("event"), eventNo: integer(1), revision: integer(1), template: optional(Schema.Struct({ name, revision: integer(1) })) }),
    Schema.Struct({ type: Schema.Literal("schedule"), scheduleNo: integer(1), planRevision: integer(1), source: Schema.Struct({ kind, name, revision: integer(1) }) }),
    Schema.Struct({ type: Schema.Literal("milestone"), kind: Schema.Literals(["birthday", "anniversary"]), intentRevision: integer(1), template: Schema.Struct({ name, revision: integer(1) }) }),
])
const eventConsumer = Schema.Struct({ type: Schema.Literal("event"), eventNo: integer(1), revision: integer(1), purpose: Schema.Literals(["card", "reminder"]),
    occurrenceNo: optional(integer(1)), offsetMinutes: optional(integer(1, 10080)), deliveryId: optional(key) }).check(Schema.makeFilter(v => v.purpose === "card"
        ? v.occurrenceNo === undefined && v.offsetMinutes === undefined && v.deliveryId === undefined
        : v.occurrenceNo !== undefined && v.offsetMinutes !== undefined && v.deliveryId !== undefined))
export const publishingMilestoneBindingFields = {
    deliveryId: key, kind: Schema.Literals(["birthday", "anniversary"]), intentRevision: integer(1), userId: id,
    joinedAt: Schema.String.check(Schema.makeFilter(v => v.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)))),
    consentRevision: integer(1), audienceGeneration: integer(1), celebrationYear: integer(100, 9999), completedYears: integer(0, 9999), generation: integer(1),
}
export const publishingMilestoneConsumerSchema = Schema.Struct({ type: Schema.Literal("milestone"), ...publishingMilestoneBindingFields }).check(Schema.makeFilter(v => v.kind === "birthday" ? v.completedYears === 0 : v.completedYears >= 1))
const consumer = Schema.Union([eventConsumer, Schema.Struct({ type: Schema.Literal("schedule"), scheduleNo: integer(1), planRevision: integer(1), occurrenceNo: integer(1), deliveryId: key }), publishingMilestoneConsumerSchema, publishingSuggestionConsumerSchema])
export const publishingGrantFields = {
    attemptId: key, postNo: integer(1), generation: integer(1), sourceId: key, actorId: id, botId: id,
    action: Schema.Literals(["send", "edit"]), channelId: id, messageId: optional(id),
    draftKind: optional(kind), draftName: optional(name), draftRevision: optional(integer(1)), source: optional(source), provenance: optional(provenance), consumer: optional(consumer),
    content, canonicalContent: content, expectedContent: optional(content),
    forumPostName: optional(Schema.String.check(Schema.makeFilter((value) => value.trim().length > 0 && value.length <= 100))), threadId: optional(id),
    dispatchExpiresAt: integer(1), nativeDeadlineMs: Schema.Literal(5000),
}
function boundProvenance(v: C.PublishingGrant) {
    if (v.provenance?.type === "dashboard-message") return v.source?.type === "dashboard-message" && v.source.jobId === v.provenance.jobId
        && v.sourceId === `dashboard_message_${v.source.jobId}` && v.action === "send" && !v.consumer && v.draftKind === undefined
    if (v.provenance?.type === "dashboard-role") return v.source?.type === "dashboard-role" && v.source.jobId === v.provenance.jobId
        && v.sourceId === `dashboard_${v.source.jobId}` && v.action === "send" && !v.consumer && v.draftKind === undefined
    if (v.provenance?.type === "suggestion-card") return v.source?.type === "suggestion-card" && v.consumer?.type === "suggestion-card"
        && v.source.suggestionNo === v.consumer.suggestionNo && v.source.cardGeneration === v.consumer.cardGeneration && v.source.desiredRevision === v.consumer.desiredRevision
        && v.provenance.suggestionNo === v.consumer.suggestionNo && v.provenance.cardGeneration === v.consumer.cardGeneration && v.provenance.desiredRevision === v.consumer.desiredRevision
        && v.sourceId === `suggestion_${v.consumer.suggestionNo}_${v.consumer.cardGeneration}_${v.consumer.desiredRevision}_${v.generation}`
        && v.draftKind === undefined && v.draftName === undefined && v.draftRevision === undefined
    if (v.provenance?.type === "milestone") return v.action === "send" && v.source?.type === "milestone-timer" && v.consumer?.type === "milestone"
        && v.consumer.kind === v.provenance.kind && v.consumer.intentRevision === v.provenance.intentRevision && v.consumer.deliveryId === v.source.deliveryId
        && v.sourceId === `milestone_timer_${v.source.deliveryId}` && v.draftKind === undefined && v.draftName === undefined && v.draftRevision === undefined
    if (v.provenance?.type === "schedule") return v.action === "send" && v.source?.type === "schedule-timer" && v.consumer?.type === "schedule"
        && v.consumer.scheduleNo === v.provenance.scheduleNo && v.consumer.planRevision === v.provenance.planRevision && v.consumer.deliveryId === v.source.deliveryId
        && v.sourceId === `schedule_timer_${v.source.deliveryId}` && v.draftKind === undefined && v.draftName === undefined && v.draftRevision === undefined
    if (v.provenance?.type === "event") return v.source !== undefined && v.consumer?.type === "event" && v.consumer.eventNo === v.provenance.eventNo && v.consumer.revision === v.provenance.revision
        && v.draftKind === undefined && v.draftName === undefined && v.draftRevision === undefined
        && (v.source.type === "human" ? v.source.messageId === v.sourceId && v.consumer.purpose === "card"
            : v.source.type === "dashboard-configuration" ? v.sourceId === v.source.jobId && v.consumer.purpose === "card"
            : v.source.type === "event-timer" && v.consumer.purpose === "reminder" && v.consumer.deliveryId === v.source.deliveryId && v.sourceId === `event_timer_${v.source.deliveryId}`)
    return !v.consumer && (!v.source || v.source.type === "human") && snowflakes.isValid(v.sourceId) && v.sourceId !== "0"
        && v.draftKind !== undefined && v.draftName !== undefined && v.draftRevision !== undefined
        && (!v.source || v.source.messageId === v.sourceId)
        && (!v.provenance || v.provenance.type === "draft" && v.provenance.kind === v.draftKind && v.provenance.name === v.draftName && v.provenance.revision === v.draftRevision)
}
export const publishingGrantSchema = Schema.Struct(publishingGrantFields).check(Schema.makeFilter((value) => canonical(value) && boundProvenance(value) && (value.action === "send" ? value.messageId === undefined && value.expectedContent === undefined : !!value.messageId && !!value.expectedContent)))
const grant = publishingGrantSchema
const resolution = Schema.Struct({ attemptId: key, generation: integer(1), sourceId: key, observedAt: integer(), matched: Schema.Literals(["intended", "previous"]) })
const attempt = Schema.Struct({ ...publishingGrantFields, outcome, createdAt: integer(), dispatchedAt: optional(integer()), noDispatch: optional(Schema.Literal(true)), finishedAt: optional(integer()),
    observation: optional(observation), resolution: optional(resolution) }).check(Schema.makeFilter((value) => canonical(value) && boundProvenance(value)
    && (value.source?.type === "schedule-timer" || value.source?.type === "milestone-timer" ? value.dispatchExpiresAt === value.createdAt + 180000
        : value.source?.type === "event-timer" ? value.consumer?.type === "event" && value.dispatchExpiresAt > value.createdAt && value.dispatchExpiresAt === Math.min(value.createdAt + 180000, value.source.dueAt + 300000, value.source.dueAt + value.consumer.offsetMinutes! * 60000)
        : value.source?.type === "dashboard-message" ? value.dispatchExpiresAt > value.createdAt && value.dispatchExpiresAt <= value.createdAt + 120000
        : value.dispatchExpiresAt === value.createdAt + 180000)
    && (value.dispatchedAt === undefined || value.dispatchedAt >= value.createdAt && value.dispatchedAt < value.dispatchExpiresAt)
    && (value.noDispatch !== true || value.outcome === "failed" && value.dispatchedAt === undefined)
    && (value.finishedAt === undefined || value.finishedAt >= value.createdAt)
    && (!value.observation || value.observation.observedAt >= value.createdAt && value.observation.messageId === value.messageId && value.observation.channelId === (value.threadId ?? value.channelId) && value.observation.botId === value.botId)
    && (!value.resolution || value.outcome === "uncertain" && value.resolution.attemptId === value.attemptId && value.resolution.generation === value.generation && value.resolution.sourceId === value.sourceId
        && value.observation?.observedAt === value.resolution.observedAt && (value.resolution.matched !== "previous" || value.expectedContent !== undefined)
        && (value.dispatchedAt === undefined || value.resolution.observedAt >= value.dispatchExpiresAt + value.nativeDeadlineMs + 5000)
        && equalPublishingContent(value.observation.content, value.resolution.matched === "intended" ? value.canonicalContent : value.expectedContent ?? { content: "" }))))
const post = Schema.Struct({ postNo: integer(1), generation: integer(1), channelId: id, botId: id, messageId: optional(id), outcome,
    createdAt: integer(), updatedAt: integer(), confirmedContent: optional(content), confirmedCanonicalContent: optional(content), confirmedDraftRevision: optional(integer(1)), attempt, consumer: optional(consumer),
}).check(Schema.makeFilter((value) => value.attempt.postNo === value.postNo && value.attempt.generation === value.generation
    && (value.attempt.threadId ?? value.attempt.channelId) === value.channelId && value.attempt.botId === value.botId && value.outcome === value.attempt.outcome
    && value.attempt.messageId === value.messageId
    && equalUnknown(value.consumer, value.attempt.consumer)
    && value.updatedAt >= value.createdAt && (value.confirmedContent === undefined ? value.confirmedCanonicalContent === undefined
        : !!value.confirmedCanonicalContent && equalPublishingContent(value.confirmedCanonicalContent, canonicalPublishingContent(value.confirmedContent)))
    && (value.outcome !== "sent" || !!value.messageId)))
export const publishingPostSchema = post
const duplicate = Schema.Struct({ duplicate: Schema.Literal(true) })
const manage = Schema.Union([duplicate,
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("draft"), draft }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("deleted"), kind, name }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("preview"), draft }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("post"), post, grant }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), postNo: integer(1) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("resolved"), post }),
])
const query = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings }), Schema.Struct({ type: Schema.Literal("draft"), draft }),
    Schema.Struct({ type: Schema.Literal("drafts"), drafts: Schema.mutable(Schema.Array(draft)).check(Schema.isMaxLength(10)), kind, page: integer(1), totalPages: integer(1) }),
    Schema.Struct({ type: Schema.Literal("post"), post }),
    Schema.Struct({ type: Schema.Literal("posts"), posts: Schema.mutable(Schema.Array(post)).check(Schema.isMaxLength(10)), nextBeforePostNo: optional(integer(1)) }),
])
const acknowledged = Schema.Struct({ recorded: Schema.Boolean })
export class PublishingStoreError extends Data.TaggedError("PublishingStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface PublishingStore {
    manage(input: C.PublishingManageRequest): Effect.Effect<C.PublishingManageResult, PublishingStoreError>
    query(input: C.PublishingQueryRequest): Effect.Effect<C.PublishingQueryResult, PublishingStoreError>
    outcome(input: C.PublishingOutcomeRequest): Effect.Effect<C.PublishingOutcomeResult, PublishingStoreError>
    reconcile(input: C.PublishingReconcileRequest): Effect.Effect<C.PublishingReconcileResult, PublishingStoreError>
    observe(input: C.PublishingObserveRequest): Effect.Effect<C.PublishingObserveResult, PublishingStoreError>
    dispatch(input: C.PublishingDispatchRequest): Effect.Effect<C.PublishingDispatchResult, PublishingStoreError>
}
function sameDraft(value: C.PublishingDraft, operation: { kind: C.PublishingKind, name: string, expectedRevision?: number }) {
    return value.kind === operation.kind && value.name === operation.name && (operation.expectedRevision === undefined || value.revision === operation.expectedRevision)
}
function matchesManage(input: C.PublishingManageRequest, result: C.PublishingManageResult) {
    if (result.duplicate) return true
    const op = input.operation
    if (op.type === "settings") return result.type === "settings" && Object.entries(op.patch).every(([key,value]) => result.settings[key as keyof C.PublishingSettings] === value)
    if (op.type === "forget") return result.type === "forgotten" && result.postNo === op.postNo
    if (op.type === "resolve") return result.type === "resolved" && result.post.postNo === op.postNo && result.post.generation === op.expectedGeneration
        && result.post.outcome === op.outcome && (op.outcome !== "sent" || result.post.messageId === op.messageId)
    if (op.type === "draft-delete") return result.type === "deleted" && result.kind === op.kind && result.name === op.name
    if (op.type === "preview") return result.type === "preview" && sameDraft(result.draft, op)
    if (op.type === "draft-create") return result.type === "draft" && sameDraft(result.draft, { ...op, expectedRevision: 1 }) && equalPublishingContent(result.draft.content, op.content ?? { content: "" })
    if (op.type === "draft-clone") return result.type === "draft" && sameDraft(result.draft, { kind: op.toKind, name: op.toName, expectedRevision: 1 })
    if (op.type === "draft-update") return result.type === "draft" && sameDraft(result.draft, { ...op, expectedRevision: op.expectedRevision + 1 })
    if (op.type === "draft-set") return result.type === "draft" && sameDraft(result.draft, { ...op, expectedRevision: op.expectedRevision + 1 }) && equalPublishingContent(result.draft.content, op.content)
    if (result.type !== "post") return false
    const value = result.grant
    const bound = Object.entries(value).every(([key,value]) => equalUnknown(value, result.post.attempt[key as keyof C.PublishingAttempt]))
    return bound && result.post.outcome === "pending" && value.sourceId === input.messageId && value.actorId === input.actor.userId
        && (!value.source || value.source.type === "human" && value.source.createdAt === input.createdAt)
        && value.action === op.type && value.draftKind === op.kind && value.draftName === op.name && value.draftRevision === op.expectedRevision
        && value.botId === op.context.botId && value.channelId === op.context.channelId
        && (op.type === "send" ? value.channelId === op.channelId && value.generation === 1 : value.postNo === op.postNo && value.generation === op.expectedGeneration + 1 && value.messageId === result.post.messageId)
}
function equalUnknown(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b) }
export function createPublishingStore(config: BackendConfig): PublishingStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/publishing/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new PublishingStoreError({ operation, status: null })),
        Effect.mapError((error) => new PublishingStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })),
    )
    return {
        manage: (input) => call("manage", input, manage, (value) => matchesManage(input, value)),
        query: (input) => call("query", input, query, (result) => {
            const op = input.operation
            if (op.type === "settings") return result.type === "settings"
            if (op.type === "draft-show") return result.type === "draft" && sameDraft(result.draft, op)
            if (op.type === "post-show") return result.type === "post" && result.post.postNo === op.postNo
            if (op.type === "draft-list") return result.type === "drafts" && result.kind === op.kind && result.page === (op.page ?? 1) && result.page <= result.totalPages && result.drafts.every((value) => value.kind === op.kind)
            return result.type === "posts" && result.posts.every((value,index) => (!op.beforePostNo || value.postNo < op.beforePostNo) && (index === 0 || result.posts[index - 1]!.postNo > value.postNo))
                && (result.nextBeforePostNo === undefined || result.posts.length === 10 && result.nextBeforePostNo === result.posts.at(-1)!.postNo)
        }),
        outcome: (input) => call("outcome", input, acknowledged),
        reconcile: (input) => call("reconcile", input, Schema.Struct({ recorded: Schema.Boolean, post }), (result) => result.post.postNo === input.postNo
            && result.post.generation === input.expectedGeneration && result.post.attempt.attemptId === input.attemptId
            && result.post.messageId === input.observation.messageId && result.post.channelId === input.observation.channelId && result.post.botId === input.observation.botId),
        observe: (input) => call("observe", input, Schema.Struct({ uncertainAttempts: integer() })),
        dispatch: (input) => call("dispatch", input, Schema.Struct({ claimed: Schema.Boolean, dispatchExpiresAt: integer(1), nativeDeadlineMs: Schema.Literal(5000) })),
    }
}

export function publishingErrorMessage(error: PublishingStoreError) {
    if (error.status === 403) return "Your current permissions, module setting, or DEFCON mode does not allow this operation"
    if (error.status === 404) return "That draft, template, or tracked post was not found"
    if (error.status === 409) return "The revision or tracked state changed. Inspect it before continuing"
    if (error.status === 400) return "Check the content and command values. The request was rejected"
    if (error.status === 429) return "The publishing request limit was reached"
    return "I couldn't confirm the operation. Check its status before attempting another write"
}
