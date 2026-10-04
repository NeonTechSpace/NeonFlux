import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { canonicalPublishingContent, equalPublishingContent, publishingContentSchema } from "./publishing-content.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= min && n <= max))
const id = Schema.String.check(Schema.makeFilter((v) => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.makeFilter((v) => v.length > 0 && v.length <= 256))
const cursor = Schema.String.check(Schema.makeFilter((v) => v.length > 0 && v.length <= 4096))
const name = Schema.String.check(Schema.makeFilter((v) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)))
const epoch = Schema.String.check(Schema.makeFilter((v) => v.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))))
const optional = Schema.optionalKey
const route = Schema.Literals(["welcome", "dm", "goodbye"])
const list = <A>(schema: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(max))
const routeSettings = Schema.Struct({ revision: integer(1), enabled: Schema.Boolean, timing: Schema.Literals(["join", "verified"]),
    channelId: optional(id), templateName: optional(name), templateRevision: optional(integer(1)), content: optional(publishingContentSchema) })
const settings = Schema.Struct({ routes: Schema.Struct({ welcome: routeSettings, dm: routeSettings, goodbye: routeSettings }),
    claimsPerMinute: integer(1, 60), retentionDays: integer(30, 3650) }).check(Schema.makeFilter((v) => v.routes.dm.channelId === undefined
        && [v.routes.welcome, v.routes.dm, v.routes.goodbye].every((r) => !r.enabled || r.content !== undefined && r.templateName !== undefined && r.templateRevision !== undefined)
        && [v.routes.welcome, v.routes.goodbye].every((r) => !r.enabled || r.channelId !== undefined)))
const binding = { deliveryId: key, route, routeRevision: integer(1), userId: id, joinedAt: epoch, memberGeneration: integer(1) }
const grant = Schema.Struct({ ...binding, deliveryNo: integer(1), templateName: name, templateRevision: integer(1), botId: id, channelId: optional(id),
    content: publishingContentSchema, canonicalContent: publishingContentSchema, dispatchExpiresAt: integer(1), nativeDeadlineMs: Schema.Literal(5000) })
    .check(Schema.makeFilter((v) => (v.route === "dm" ? v.channelId === undefined : v.channelId !== undefined)
        && equalPublishingContent(canonicalPublishingContent(v.content), v.canonicalContent)))
const member = Schema.Struct({ userId: id, joinedAt: epoch, generation: integer(1), present: Schema.Boolean, observedAt: integer(), expiresAt: integer(1) })
const delivery = Schema.Struct({ ...binding, deliveryNo: integer(1), state: Schema.Literals(["waiting", "ready", "reserved", "sent", "failed", "uncertain", "cancelled", "expired"]),
    createdAt: integer(), pendingExpiresAt: integer(1), nextCheckAt: integer(), reason: optional(Schema.Literals(["verification", "eligibility", "configuration", "membership", "lifetime", "capacity"])),
    grant: optional(grant), claimedAt: optional(integer()), finishedAt: optional(integer()), noDispatch: optional(Schema.Literal(true)), messageId: optional(id), channelId: optional(id) })
    .check(Schema.makeFilter((v) => (!v.grant || matchesBinding(v, v.grant) && v.deliveryNo === v.grant.deliveryNo) && (!v.noDispatch || ["failed", "expired", "cancelled"].includes(v.state))
        && (v.messageId === undefined || v.channelId !== undefined)
        && (!["sent", "uncertain"].includes(v.state) || v.grant !== undefined && v.claimedAt !== undefined)
        && (v.state !== "sent" || v.messageId !== undefined && v.channelId !== undefined)
        && (v.claimedAt === undefined || !!v.grant && v.claimedAt < v.grant.dispatchExpiresAt)))
const query = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings }),
    Schema.Struct({ type: Schema.Literal("member"), member: Schema.NullOr(member) }),
    Schema.Struct({ type: Schema.Literal("delivery"), delivery }),
    Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: list(delivery, 10), nextBeforeDeliveryNo: optional(integer(1)) }),
    Schema.Struct({ type: Schema.Literal("preview"), content: publishingContentSchema, canonicalContent: publishingContentSchema }),
])
const recorded = Schema.Struct({ recorded: Schema.Boolean })
const candidate = Schema.Struct({ ...binding, channelId: optional(id), hasEmbed: Schema.Boolean }).check(Schema.makeFilter((v) => v.route === "dm" ? v.channelId === undefined : v.channelId !== undefined))
function matchesBinding(input: Omit<C.GreetingsBinding, "serverId">, output: Omit<C.GreetingsBinding, "serverId">) {
    return input.deliveryId === output.deliveryId && input.route === output.route && input.routeRevision === output.routeRevision
        && input.userId === output.userId && input.joinedAt === output.joinedAt && input.memberGeneration === output.memberGeneration
}
export class GreetingsStoreError extends Data.TaggedError("GreetingsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface GreetingsStore {
    manage(input: C.GreetingsManageRequest): Effect.Effect<C.GreetingsManageResult, GreetingsStoreError>
    query(input: C.GreetingsQueryRequest): Effect.Effect<C.GreetingsQueryResult, GreetingsStoreError>
    observe(input: C.GreetingsObserveRequest): Effect.Effect<C.GreetingsObserveResult, GreetingsStoreError>
    pending(input: C.GreetingsPendingRequest): Effect.Effect<C.GreetingsPendingResult, GreetingsStoreError>
    member(input: C.GreetingsMemberRequest): Effect.Effect<C.GreetingsMemberResult, GreetingsStoreError>
    discover(input: C.GreetingsDiscoverRequest): Effect.Effect<C.GreetingsDiscoverResult, GreetingsStoreError>
    reserve(input: C.GreetingsReserveRequest): Effect.Effect<C.GreetingsReserveResult, GreetingsStoreError>
    dispatch(input: C.GreetingsDispatchRequest): Effect.Effect<C.GreetingsDispatchResult, GreetingsStoreError>
    outcome(input: C.GreetingsOutcomeRequest): Effect.Effect<C.GreetingsOutcomeResult, GreetingsStoreError>
    defer(input: C.GreetingsDeferRequest): Effect.Effect<C.GreetingsDeferResult, GreetingsStoreError>
}
export function createGreetingsStore(config: BackendConfig): GreetingsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/greetings/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new GreetingsStoreError({ operation, status: null })),
        Effect.mapError((error) => new GreetingsStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: (input) => call("manage", input, Schema.Struct({ duplicate: Schema.Boolean, settings }), (v) => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "settings") return (op.claimsPerMinute === undefined || v.settings.claimsPerMinute === op.claimsPerMinute)
                && (op.retentionDays === undefined || v.settings.retentionDays === op.retentionDays)
            const r = v.settings.routes[op.route]
            if (op.type === "clear") return !r.enabled && r.templateName === undefined && r.templateRevision === undefined && r.content === undefined && r.channelId === undefined
            return op.type === "module" ? r.enabled === op.enabled : r.templateName === op.templateName && r.templateRevision === op.expectedTemplateRevision
                && r.channelId === op.channelId && (op.timing === undefined || r.timing === op.timing)
        }),
        query: (input) => call("query", input, query, (v) => {
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
        observe: (input) => call("observe", input, Schema.Struct({ recorded: Schema.Boolean, member: Schema.NullOr(member), admitted: integer(0, 2) }), (v) => {
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
        member: (input) => call("member", input, Schema.Struct({ member: Schema.NullOr(member) }), (v) => !v.member || v.member.userId === input.userId),
        discover: (input) => call("discover", input, Schema.Struct({ scanAt: integer(), examined: integer(0, 10), queued: integer(0, 10), nextCursor: optional(cursor) }),
            (v) => v.queued <= v.examined && (input.scanAt === undefined || v.scanAt === input.scanAt)),
        pending: (input) => call("pending", input, Schema.Struct({ scanAt: integer(), candidates: list(candidate, 10), nextCursor: optional(cursor), nextClaimAt: integer(), nextCheckAt: optional(integer()) }),
            (v) => new Set(v.candidates.map((c) => c.deliveryId)).size === v.candidates.length && (input.scanAt === undefined || v.scanAt === input.scanAt)
                && (input.userId === undefined || v.candidates.every(c => c.userId === input.userId))),
        reserve: (input) => call("reserve", input, Schema.Union([
            Schema.Struct({ status: Schema.Literal("reserved"), grant }),
            Schema.Struct({ status: Schema.Literals(["waiting", "cancelled", "expired", "terminal"]) }),
        ]), (v) => v.status !== "reserved" || matchesBinding(input, v.grant) && v.grant.botId === input.context.botId
            && (v.grant.route === "dm" || v.grant.channelId === input.context.channelId)),
        dispatch: (input) => call("dispatch", input, Schema.Struct({ claimed: Schema.Boolean, dispatchExpiresAt: integer(1), nativeDeadlineMs: Schema.Literal(5000), nextClaimAt: integer() })),
        outcome: (input) => call("outcome", input, recorded),
        defer: (input) => call("defer", input, Schema.Struct({ deferred: Schema.Boolean })),
    }
}
