import {
    GreetingsDeferResult, GreetingsDiscoverResult, GreetingsDispatchResult, GreetingsManageResult, GreetingsMemberResult, GreetingsObserveResult, GreetingsOutcomeResult,
    GreetingsPendingResult, GreetingsQueryResult, GreetingsReserveResult, type GreetingsBinding, type GreetingsDeferRequest, type GreetingsDiscoverRequest, type GreetingsDispatchRequest,
    type GreetingsManageRequest, type GreetingsMemberRequest, type GreetingsObserveRequest, type GreetingsOutcomeRequest, type GreetingsPendingRequest, type GreetingsQueryRequest,
    type GreetingsReserveRequest,
} from "@neonflux/contracts/greetings"
import { canonicalPublishingContent, equalPublishingContent } from "@neonflux/contracts/publishing-base"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

function matchesBinding(input: Omit<GreetingsBinding, "serverId">, output: Omit<GreetingsBinding, "serverId">) {
    return input.deliveryId === output.deliveryId && input.route === output.route && input.routeRevision === output.routeRevision
        && input.userId === output.userId && input.joinedAt === output.joinedAt && input.memberGeneration === output.memberGeneration
}
export class GreetingsStoreError extends Data.TaggedError("GreetingsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface GreetingsStore {
    manage(input: GreetingsManageRequest): Effect.Effect<GreetingsManageResult, GreetingsStoreError>
    query(input: GreetingsQueryRequest): Effect.Effect<GreetingsQueryResult, GreetingsStoreError>
    observe(input: GreetingsObserveRequest): Effect.Effect<GreetingsObserveResult, GreetingsStoreError>
    pending(input: GreetingsPendingRequest): Effect.Effect<GreetingsPendingResult, GreetingsStoreError>
    member(input: GreetingsMemberRequest): Effect.Effect<GreetingsMemberResult, GreetingsStoreError>
    discover(input: GreetingsDiscoverRequest): Effect.Effect<GreetingsDiscoverResult, GreetingsStoreError>
    reserve(input: GreetingsReserveRequest): Effect.Effect<GreetingsReserveResult, GreetingsStoreError>
    dispatch(input: GreetingsDispatchRequest): Effect.Effect<GreetingsDispatchResult, GreetingsStoreError>
    outcome(input: GreetingsOutcomeRequest): Effect.Effect<GreetingsOutcomeResult, GreetingsStoreError>
    defer(input: GreetingsDeferRequest): Effect.Effect<GreetingsDeferResult, GreetingsStoreError>
}
export function createGreetingsStore(config: BackendConfig): GreetingsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/greetings/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new GreetingsStoreError({ operation, status: null })),
        Effect.mapError((error) => new GreetingsStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: (input) => call("manage", input, GreetingsManageResult, (v) => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "settings") return (op.claimsPerMinute === undefined || v.settings.claimsPerMinute === op.claimsPerMinute)
                && (op.retentionDays === undefined || v.settings.retentionDays === op.retentionDays)
            const r = v.settings.routes[op.route]
            if (op.type === "clear") return !r.enabled && r.templateName === undefined && r.templateRevision === undefined && r.content === undefined && r.channelId === undefined
            return op.type === "module" ? r.enabled === op.enabled : r.templateName === op.templateName && r.templateRevision === op.expectedTemplateRevision
                && r.channelId === op.channelId && (op.timing === undefined || r.timing === op.timing)
        }),
        query: (input) => call("query", input, GreetingsQueryResult, (v) => {
            const op = input.operation
            if (v.type !== op.type) return false
            if (op.type === "member" && v.type === "member") return !v.member || v.member.userId === op.userId
            if (op.type === "delivery" && v.type === "delivery") return v.delivery.deliveryNo === op.deliveryNo
            if (op.type === "deliveries" && v.type === "deliveries") return v.deliveries.every((d, i) => (op.beforeDeliveryNo === undefined || d.deliveryNo < op.beforeDeliveryNo)
                && (i === 0 || d.deliveryNo < v.deliveries[i - 1]!.deliveryNo))
                && (v.nextBeforeDeliveryNo === undefined || v.deliveries.length === 10 && v.nextBeforeDeliveryNo === v.deliveries.at(-1)!.deliveryNo)
            if (v.type === "preview") return equalPublishingContent(canonicalPublishingContent(v.content), v.canonicalContent)
            return true
        }),
        observe: (input) => call("observe", input, GreetingsObserveResult, (v) => {
            const op = input.operation
            if (!v.member) return !v.recorded && v.admitted === 0
            if (v.member.userId !== (op.type === "absent" || op.type === "departed" ? op.userId : op.member.userId)) return false
            if (!v.recorded) return v.admitted === 0
            if (v.member.observedAt !== op.observedAt) return false
            if (op.type === "join") return v.member.present && v.member.joinedAt === op.member.joinedAt
            if (op.type === "departed") return !v.member.present && v.admitted <= 1
            if (op.type === "absent") return !v.member.present && v.member.joinedAt === op.joinedAt && v.member.generation > op.expectedGeneration && v.admitted <= 1
            return v.admitted === 0 && (v.member.present ? v.member.joinedAt === op.member.joinedAt && v.member.generation >= op.expectedGeneration
                : v.member.generation > op.expectedGeneration && (op.member.isBot || v.member.joinedAt !== op.member.joinedAt))
        }),
        member: (input) => call("member", input, GreetingsMemberResult, (v) => !v.member || v.member.userId === input.userId),
        discover: (input) => call("discover", input, GreetingsDiscoverResult, (v) => v.queued <= v.examined && (input.scanAt === undefined || v.scanAt === input.scanAt)),
        pending: (input) => call("pending", input, GreetingsPendingResult,
            (v) => new Set(v.candidates.map((c) => c.deliveryId)).size === v.candidates.length && (input.scanAt === undefined || v.scanAt === input.scanAt)
                && (input.userId === undefined || v.candidates.every(c => c.userId === input.userId))),
        reserve: (input) => call("reserve", input, GreetingsReserveResult, (v) => v.status !== "reserved" || matchesBinding(input, v.grant) && v.grant.botId === input.context.botId
            && (v.grant.route === "dm" || v.grant.channelId === input.context.channelId)),
        dispatch: (input) => call("dispatch", input, GreetingsDispatchResult),
        outcome: (input) => call("outcome", input, GreetingsOutcomeResult),
        defer: (input) => call("defer", input, GreetingsDeferResult),
    }
}
