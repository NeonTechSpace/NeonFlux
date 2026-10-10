import { PublishingDispatchResult, PublishingManageResult, PublishingObserveResult, PublishingOutcomeResult, PublishingQueryResult, PublishingReconcileResult, type PublishingDispatchRequest,
    type PublishingDraft, type PublishingManageRequest, type PublishingObserveRequest, type PublishingOutcomeRequest, type PublishingQueryRequest, type PublishingReconcileRequest,
    type PublishingSettings } from "@neonflux/contracts/publishing"
import { equalPublishingContent, type PublishingAttempt, type PublishingKind } from "@neonflux/contracts/publishing-base"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

// The grant schema now lives in @neonflux/contracts/publishing-base. This name stays until every bot file imports from there
export class PublishingStoreError extends Data.TaggedError("PublishingStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface PublishingStore {
    manage(input: PublishingManageRequest): Effect.Effect<PublishingManageResult, PublishingStoreError>
    query(input: PublishingQueryRequest): Effect.Effect<PublishingQueryResult, PublishingStoreError>
    outcome(input: PublishingOutcomeRequest): Effect.Effect<PublishingOutcomeResult, PublishingStoreError>
    reconcile(input: PublishingReconcileRequest): Effect.Effect<PublishingReconcileResult, PublishingStoreError>
    observe(input: PublishingObserveRequest): Effect.Effect<PublishingObserveResult, PublishingStoreError>
    dispatch(input: PublishingDispatchRequest): Effect.Effect<PublishingDispatchResult, PublishingStoreError>
}
function sameDraft(value: PublishingDraft, operation: { kind: PublishingKind, name: string, expectedRevision?: number }) {
    return value.kind === operation.kind && value.name === operation.name && (operation.expectedRevision === undefined || value.revision === operation.expectedRevision)
}
function matchesManage(input: PublishingManageRequest, result: PublishingManageResult) {
    if (result.duplicate) return true
    const op = input.operation
    if (op.type === "settings") return result.type === "settings" && Object.entries(op.patch).every(([key,value]) => result.settings[key as keyof PublishingSettings] === value)
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
    const bound = Object.entries(value).every(([key,value]) => equalUnknown(value, result.post.attempt[key as keyof PublishingAttempt]))
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
        manage: (input) => call("manage", input, PublishingManageResult, (value) => matchesManage(input, value)),
        query: (input) => call("query", input, PublishingQueryResult, (result) => {
            const op = input.operation
            if (op.type === "settings") return result.type === "settings"
            if (op.type === "draft-show") return result.type === "draft" && sameDraft(result.draft, op)
            if (op.type === "post-show") return result.type === "post" && result.post.postNo === op.postNo
            if (op.type === "draft-list") return result.type === "drafts" && result.kind === op.kind && result.page === (op.page ?? 1) && result.page <= result.totalPages && result.drafts.every((value) => value.kind === op.kind)
            return result.type === "posts" && result.posts.every((value,index) => (!op.beforePostNo || value.postNo < op.beforePostNo) && (index === 0 || result.posts[index - 1]!.postNo > value.postNo))
                && (result.nextBeforePostNo === undefined || result.posts.length === 10 && result.nextBeforePostNo === result.posts.at(-1)!.postNo)
        }),
        outcome: (input) => call("outcome", input, PublishingOutcomeResult),
        reconcile: (input) => call("reconcile", input, PublishingReconcileResult, (result) => result.post.postNo === input.postNo
            && result.post.generation === input.expectedGeneration && result.post.attempt.attemptId === input.attemptId
            && result.post.messageId === input.observation.messageId && result.post.channelId === input.observation.channelId && result.post.botId === input.observation.botId),
        observe: (input) => call("observe", input, PublishingObserveResult),
        dispatch: (input) => call("dispatch", input, PublishingDispatchResult),
    }
}

export function publishingErrorMessage(error: PublishingStoreError) {
    if (error.status === 403) return "You can't do that with publishing right now. Your permissions, the publishing setting or the DEFCON level don't allow it"
    if (error.status === 404) return "That draft, template or post was not found"
    if (error.status === 409) return "The draft or post changed while this command ran. Check it, then send the command again"
    if (error.status === 400) return "That publishing change is not valid. Check the content and the command"
    if (error.status === 429) return "This server has reached its publishing limit. Try again later"
    return "The change could not be confirmed. Check it before you try again"
}
