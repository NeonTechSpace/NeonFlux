import {
    TicketDispatchResult, TicketIntakeResult, TicketManageResult, TicketOpenIntakesResult, TicketOutcomeResult, TicketQueryResult, TicketReconcileResult, TicketTranscriptUploadResult,
    type TicketActionGrant, type TicketDispatchRequest, type TicketIntakeRequest, type TicketManageRequest, type TicketOpenIntakesRequest, type TicketOutcomeRequest,
    type TicketQueryRequest, type TicketReconcileRequest, type TicketRecord, type TicketSource, type TicketTranscriptUploadRequest,
} from "@neonflux/contracts/tickets"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

/** A returned grant must belong to this request's source, actor, bot and ticket */
function boundGrant(input: TicketSource, grant: TicketActionGrant, row: TicketRecord) {
    return grant.sourceId === input.messageId && grant.actorId === input.context.actor.userId && grant.botId === input.context.botId
        && grant.ticketNo === row.ticketNo && grant.generation === row.generation
}
export class TicketStoreError extends Data.TaggedError("TicketStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface TicketStore {
    manage(input: TicketManageRequest): Effect.Effect<TicketManageResult, TicketStoreError>
    query(input: TicketQueryRequest): Effect.Effect<TicketQueryResult, TicketStoreError>
    intake(input: TicketIntakeRequest): Effect.Effect<TicketIntakeResult, TicketStoreError>
    dispatch(input: TicketDispatchRequest): Effect.Effect<TicketDispatchResult, TicketStoreError>
    outcome(input: TicketOutcomeRequest): Effect.Effect<TicketOutcomeResult, TicketStoreError>
    reconcile(input: TicketReconcileRequest): Effect.Effect<TicketReconcileResult, TicketStoreError>
    transcriptUpload(input: TicketTranscriptUploadRequest): Effect.Effect<TicketTranscriptUploadResult, TicketStoreError>
    /** Binds no server, so only a store on the root backend configuration can send it */
    openIntakes(input: TicketOpenIntakesRequest): Effect.Effect<TicketOpenIntakesResult, TicketStoreError>
}
export function createTicketStore(config: BackendConfig): TicketStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true, path = `/tickets/${operation}`) => request(path, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new TicketStoreError({ operation, status: null })),
        Effect.mapError(error => new TicketStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, TicketManageResult, v => v.duplicate || v.type !== "ticket" || !v.grant || boundGrant(input, v.grant, v.ticket)),
        intake: input => call("intake", input, TicketIntakeResult, v => v.duplicate || v.type !== "ticket" || boundGrant(input, v.grant, v.ticket)),
        query: input => call("query", input, TicketQueryResult, v => v.type === input.operation.type),
        dispatch: input => call("dispatch", input, TicketDispatchResult),
        outcome: input => call("outcome", input, TicketOutcomeResult, v => v.ticket.ticketNo === input.ticketNo
            && (!v.grant || v.grant.sourceId === input.sourceId && v.grant.ticketNo === input.ticketNo && v.grant.generation === v.ticket.generation)),
        reconcile: input => call("reconcile", input, TicketReconcileResult, v => v.ticket.ticketNo === input.ticketNo),
        transcriptUpload: input => call("transcript", input, TicketTranscriptUploadResult, v => v.transcript.ticketNo === input.ticketNo),
        openIntakes: input => call("open-intakes", input, TicketOpenIntakesResult, undefined, "/service/ticket-intakes"),
    }
}
