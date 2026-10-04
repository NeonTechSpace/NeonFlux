import {
    TicketDispatchResult,
    TicketIntakeResult,
    TicketManageResult,
    TicketOutcomeResult,
    TicketQueryResult,
    TicketReconcileResult,
    TicketTranscriptUploadResult,
    type TicketActionGrant,
    type TicketDispatchRequest,
    type TicketIntakeRequest,
    type TicketManageRequest,
    type TicketOutcomeRequest,
    type TicketQueryRequest,
    type TicketReconcileRequest,
    type TicketRecord,
    type TicketSource,
    type TicketTranscriptUploadRequest,
} from "@neonflux/contracts/tickets"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest, failureFields } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

/** A returned grant must belong to this request's source, actor, bot and ticket */
function boundGrant(input: TicketSource, grant: TicketActionGrant, row: TicketRecord) {
    return (
        grant.sourceId === input.messageId &&
        grant.actorId === input.context.actor.userId &&
        grant.botId === input.context.botId &&
        grant.ticketNo === row.ticketNo &&
        grant.generation === row.generation
    )
}
export class TicketStoreError extends Data.TaggedError("TicketStoreError")<{
    readonly operation: string
    readonly status: number | null
    readonly code?: string
    readonly reason?: string
}> {}
export interface TicketStore {
    manage(input: TicketManageRequest): Effect.Effect<TicketManageResult, TicketStoreError>
    query(input: TicketQueryRequest): Effect.Effect<TicketQueryResult, TicketStoreError>
    intake(input: TicketIntakeRequest): Effect.Effect<TicketIntakeResult, TicketStoreError>
    dispatch(input: TicketDispatchRequest): Effect.Effect<TicketDispatchResult, TicketStoreError>
    outcome(input: TicketOutcomeRequest): Effect.Effect<TicketOutcomeResult, TicketStoreError>
    reconcile(input: TicketReconcileRequest): Effect.Effect<TicketReconcileResult, TicketStoreError>
    transcriptUpload(
        input: TicketTranscriptUploadRequest,
    ): Effect.Effect<TicketTranscriptUploadResult, TicketStoreError>
}
export function createTicketStore(config: BackendConfig): TicketStore {
    const request = createBackendRequest(config)
    const call = <A>(
        operation: string,
        input: unknown,
        schema: Schema.Codec<A>,
        matches: (value: A) => boolean = () => true,
    ) =>
        request(`/tickets/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.filterOrFail(matches, () => new TicketStoreError({ operation, status: null })),
            Effect.mapError(
                (error) =>
                    new TicketStoreError({
                        operation,
                        ...failureFields(error),
                    }),
            ),
        )
    return {
        manage: (input) =>
            call(
                "manage",
                input,
                TicketManageResult,
                (v) => v.duplicate || v.type !== "ticket" || !v.grant || boundGrant(input, v.grant, v.ticket),
            ),
        intake: (input) =>
            call(
                "intake",
                input,
                TicketIntakeResult,
                (v) => v.duplicate || v.type !== "ticket" || boundGrant(input, v.grant, v.ticket),
            ),
        query: (input) => call("query", input, TicketQueryResult, (v) => v.type === input.operation.type),
        dispatch: (input) => call("dispatch", input, TicketDispatchResult),
        outcome: (input) =>
            call(
                "outcome",
                input,
                TicketOutcomeResult,
                (v) =>
                    v.ticket.ticketNo === input.ticketNo &&
                    (!v.grant ||
                        (v.grant.sourceId === input.sourceId &&
                            v.grant.ticketNo === input.ticketNo &&
                            v.grant.generation === v.ticket.generation)),
            ),
        reconcile: (input) =>
            call("reconcile", input, TicketReconcileResult, (v) => v.ticket.ticketNo === input.ticketNo),
        transcriptUpload: (input) =>
            call("transcript", input, TicketTranscriptUploadResult, (v) => v.transcript.ticketNo === input.ticketNo),
    }
}
