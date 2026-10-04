import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { publishingContentSchema } from "./publishing-content.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(n => Number.isSafeInteger(n) && n >= min && n <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.makeFilter(v => /^[a-zA-Z0-9_-]{1,256}$/.test(v)))
const name = Schema.String.check(Schema.makeFilter(v => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)))
const text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const epoch = Schema.String.check(Schema.makeFilter(v => v.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))))
const optional = Schema.optionalKey
const list = <A>(schema: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(max))
const visibility = Schema.Literals(["private", "public"])
const permissions = Schema.String.check(Schema.makeFilter(v => /^(?:0|[1-9]\d{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n))
const overwrite = Schema.Struct({ id, type: Schema.Literals(["role", "member"]), allow: permissions, deny: permissions })
const overwrites = list(overwrite, 100)
const channel = Schema.Struct({ channelId: id, serverId: id, type: Schema.Literal("text"), name: text(100), parentId: Schema.NullOr(id), overwrites })
const settings = Schema.Struct({ enabled: Schema.Boolean, retentionDays: integer(1, 365) })
const summaryFields = { name, revision: integer(1), enabled: Schema.Boolean, visibility, description: text(1000) }
const categorySummary = Schema.Struct(summaryFields)
const intakeCategory = Schema.Struct({ ...summaryFields, parentId: Schema.NullOr(id), supportRoleIds: list(id, 20), questions: list(text(200), 5) })
const canned = Schema.Struct({ name, templateName: name, templateRevision: integer(1), content: publishingContentSchema })
const category = Schema.Struct({ ...summaryFields, parentId: Schema.NullOr(id), supportRoleIds: list(id, 20), questions: list(text(200), 5),
    cannedReplies: list(canned, 20) })
const intake = Schema.Struct({ intakeNo: integer(1), generation: integer(1), category: intakeCategory, requesterId: id, joinedAt: epoch,
    answers: list(text(2000), 5), state: Schema.Literals(["draft", "submitted", "cancelled", "expired"]), createdAt: integer(), expiresAt: integer(1),
    ticketNo: optional(integer(1)) })
const action = Schema.Literals(["create", "introduction", "reply", "close-everyone", "close-requester", "reopen-requester", "reopen-everyone", "delete"])
const grantFields = { attemptId: key, attemptNo: integer(1), ticketNo: integer(1), generation: integer(1), sourceId: id, actorId: id, botId: id,
    requesterId: id, requesterJoinedAt: epoch, visibility, supportRoleIds: list(id, 20), action, dispatchExpiresAt: integer(1),
    nativeDeadlineMs: Schema.Literal(5000), channelId: optional(id), expectedChannel: optional(channel), desiredChannel: optional(channel),
    targetOverwrite: optional(overwrite), channelName: optional(text(100)), parentId: optional(Schema.NullOr(id)), overwrites: optional(overwrites),
    content: optional(publishingContentSchema) }
const grant = Schema.Struct(grantFields)
const historyFields = { outcome: Schema.Literals(["pending", "succeeded", "failed", "uncertain"]), createdAt: integer(), claimedAt: optional(integer()),
    finishedAt: optional(integer()), noDispatch: optional(Schema.Literal(true)), messageId: optional(id), observationAt: optional(integer()),
    resolved: optional(Schema.Literals(["before", "desired", "absent"])), redacted: optional(Schema.Literal(true)),
    nativeDeleteConfirmed: optional(Schema.Literal(true)) }
const attempt = Schema.Struct({ ...grantFields, ...historyFields })
const { content: _privatePayload, ...publicGrantFields } = grantFields
const publicAttempt = Schema.Struct({ ...publicGrantFields, ...historyFields })
const state = Schema.Literals(["creating", "open", "closing", "closed", "reopening", "deleting", "retired", "failed", "uncertain"])
const ticket = Schema.Struct({ ticketNo: integer(1), requesterId: id, requesterJoinedAt: epoch, categoryName: name, categoryRevision: integer(1), visibility,
    supportRoleIds: list(id, 20), state, generation: integer(), botId: id, channelId: optional(id), channel: optional(channel), claimedBy: optional(id),
    priority: Schema.Literals(["low", "normal", "high", "urgent"]), createdAt: integer(), closedAt: optional(integer()), retiredAt: optional(integer()),
    bodyExpiresAt: optional(integer()), erased: Schema.Boolean, entryCount: integer(0, 200), currentAttempt: optional(publicAttempt),
    transition: optional(Schema.Literals(["close", "reopen"])), completedSteps: optional(integer(0, 2)) })
const locator = Schema.Struct({ ticketNo: integer(1), requesterId: id, supportRoleIds: list(id, 20), state, generation: integer(), botId: id,
    channelId: optional(id), retiredAt: optional(integer()) })
const entry = Schema.Struct({ entryNo: integer(1), ticketNo: integer(1), authorId: id, kind: Schema.Literals(["reply", "note"]), createdAt: integer(),
    content: optional(publishingContentSchema), erased: Schema.Boolean, attemptNo: optional(integer(1)) })
const transcript = Schema.Struct({ transcriptNo: integer(1), ticketNo: integer(1), channelId: id, capturedAt: integer(), messageCount: integer(0, 500),
    truncated: Schema.Boolean, erased: Schema.Boolean, pages: integer(1) })
const query = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings }),
    Schema.Struct({ type: Schema.Literal("categories"), categories: list(categorySummary, 20) }),
    Schema.Struct({ type: Schema.Literal("category"), category: categorySummary }),
    Schema.Struct({ type: Schema.Literal("category-config"), category }),
    Schema.Struct({ type: Schema.Literal("intake"), intake }),
    Schema.Struct({ type: Schema.Literal("intakes"), intakes: list(intake, 20), nextBeforeIntakeNo: optional(integer(1)) }),
    Schema.Struct({ type: Schema.Literal("ticket"), ticket }),
    Schema.Struct({ type: Schema.Literal("locate"), ticket: locator }),
    Schema.Struct({ type: Schema.Literal("tickets"), tickets: list(ticket, 20), nextBeforeTicketNo: optional(integer(1)) }),
    Schema.Struct({ type: Schema.Literal("private-intake"), ticketNo: integer(1), questions: list(text(200), 5), answers: list(text(2000), 5),
        erased: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("entries"), entries: list(entry, 20), nextBeforeEntryNo: optional(integer(1)) }),
    Schema.Struct({ type: Schema.Literal("attempt"), attempt }),
    Schema.Struct({ type: Schema.Literal("transcripts"), transcripts: list(transcript, 20), nextBeforeTranscriptNo: optional(integer(1)) }),
    Schema.Struct({ type: Schema.Literal("transcript"), transcript, page: integer(1), text: text(1500) }),
])
const duplicate = Schema.Struct({ duplicate: Schema.Literal(true) })
const manage = Schema.Union([duplicate,
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("category"), category }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("deleted"), name }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("ticket"), ticket, grant: optional(grant) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("entry"), entry })])
const intakeResult = Schema.Union([duplicate,
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("intake"), intake }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("ticket"), ticket, grant })])
/** A returned grant must belong to this request's source, actor, bot and ticket */
function boundGrant(input: C.TicketSource, grant: C.TicketActionGrant, row: C.TicketRecord) {
    return grant.sourceId === input.messageId && grant.actorId === input.context.actor.userId && grant.botId === input.context.botId
        && grant.ticketNo === row.ticketNo && grant.generation === row.generation
}
export class TicketStoreError extends Data.TaggedError("TicketStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface TicketStore {
    manage(input: C.TicketManageRequest): Effect.Effect<C.TicketManageResult, TicketStoreError>
    query(input: C.TicketQueryRequest): Effect.Effect<C.TicketQueryResult, TicketStoreError>
    intake(input: C.TicketIntakeRequest): Effect.Effect<C.TicketIntakeResult, TicketStoreError>
    dispatch(input: C.TicketDispatchRequest): Effect.Effect<C.TicketDispatchResult, TicketStoreError>
    outcome(input: C.TicketOutcomeRequest): Effect.Effect<C.TicketOutcomeResult, TicketStoreError>
    reconcile(input: C.TicketReconcileRequest): Effect.Effect<C.TicketReconcileResult, TicketStoreError>
    transcriptUpload(input: C.TicketTranscriptUploadRequest): Effect.Effect<C.TicketTranscriptUploadResult, TicketStoreError>
}
export function createTicketStore(config: BackendConfig): TicketStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/tickets/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new TicketStoreError({ operation, status: null })),
        Effect.mapError(error => new TicketStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, manage, v => v.duplicate || v.type !== "ticket" || !v.grant || boundGrant(input, v.grant, v.ticket)),
        intake: input => call("intake", input, intakeResult, v => v.duplicate || v.type !== "ticket" || boundGrant(input, v.grant, v.ticket)),
        query: input => call("query", input, query, v => v.type === input.operation.type),
        dispatch: input => call("dispatch", input, Schema.Struct({ claimed: Schema.Boolean, dispatchExpiresAt: integer(1), nativeDeadlineMs: Schema.Literal(5000) })),
        outcome: input => call("outcome", input, Schema.Struct({ recorded: Schema.Boolean, ticket, grant: optional(grant) }), v => v.ticket.ticketNo === input.ticketNo
            && (!v.grant || v.grant.sourceId === input.sourceId && v.grant.ticketNo === input.ticketNo && v.grant.generation === v.ticket.generation)),
        reconcile: input => call("reconcile", input, Schema.Struct({ recorded: Schema.Boolean, ticket }), v => v.ticket.ticketNo === input.ticketNo),
        transcriptUpload: input => call("transcript", input, Schema.Struct({ duplicate: Schema.Boolean, transcript }), v => v.transcript.ticketNo === input.ticketNo),
    }
}
