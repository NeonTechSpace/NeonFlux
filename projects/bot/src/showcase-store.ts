import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { publishingGrantSchema } from "./publishing-store.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min && v <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/))
const text = (max: number, min = 1) => Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max))
const ids = Schema.mutable(Schema.Array(id)).check(Schema.isMaxLength(100))
export const memberAccessSchema = Schema.Struct({ allowRoleIds: ids, blockRoleIds: ids, allowUserIds: ids, blockUserIds: ids })
export const memberLinksSchema = Schema.mutable(Schema.Array(text(500))).check(Schema.isMaxLength(3))
/** A member request as the backend reports it, with its operation decoded by the feature */
export const memberJobSchema = <O>(operation: Schema.Codec<O>) => Schema.Struct({ id: key, actorId: id, operation, state: Schema.Literals(["queued", "applied", "failed"]), createdAt: integer(), expiresAt: integer(),
    error: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(512))) })
const content = { title: text(100), text: text(1000), links: memberLinksSchema }
const showcaseNo = integer(1)
const operation = Schema.Union([Schema.Struct({ type: Schema.Literal("create"), ...content }), Schema.Struct({ type: Schema.Literal("edit"), showcaseNo, ...content }), Schema.Struct({ type: Schema.Literal("delete"), showcaseNo })])
const job = memberJobSchema(operation)
const settings = Schema.Struct({ enabled: Schema.Boolean, channelId: Schema.NullOr(id), maxPerMember: Schema.NullOr(integer(1, 50)), intervalMinutes: Schema.NullOr(integer(1, 10080)) })
const state = Schema.Struct({ revision: integer(), settings, access: memberAccessSchema })
export const showcaseSchema = Schema.Struct({ showcaseNo, authorId: id, ...content, channelId: id, postNo: integer(1), messageId: Schema.optionalKey(id), status: Schema.Literals(["posting", "posted", "unconfirmed", "failed"]),
    createdAt: integer(), updatedAt: integer() })

export class ShowcaseStoreError extends Data.TaggedError("ShowcaseStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface ShowcaseStore {
    manage(input: C.ShowcaseManageRequest): Effect.Effect<C.ShowcaseState, ShowcaseStoreError>
    settings(input: C.ShowcaseSettingsRequest): Effect.Effect<C.ShowcaseState, ShowcaseStoreError>
    list(input: C.ShowcaseListRequest): Effect.Effect<C.ShowcaseListResult, ShowcaseStoreError>
    ready(input: C.ShowcaseReadyRequest): Effect.Effect<C.ShowcaseReadyResult, ShowcaseStoreError>
    start(input: C.ShowcaseStartRequest): Effect.Effect<C.ShowcaseStartResult, ShowcaseStoreError>
    complete(input: C.ShowcaseCompleteRequest): Effect.Effect<C.ShowcaseCompleteResult, ShowcaseStoreError>
    fail(input: C.ShowcaseFailRequest): Effect.Effect<null, ShowcaseStoreError>
}
export function createShowcaseStore(config: BackendConfig): ShowcaseStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/showcase/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new ShowcaseStoreError({ operation, status: null })),
        Effect.mapError(error => new ShowcaseStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    const sameJob = (input: { jobId: string }) => (value: { job: { id: string } }) => value.job.id === input.jobId
    return {
        manage: input => call("manage", input, state),
        settings: input => call("settings", input, state),
        list: input => call("list", input, Schema.Struct({ showcases: Schema.mutable(Schema.Array(showcaseSchema)).check(Schema.isMaxLength(10)), more: Schema.Boolean })),
        ready: input => call("ready", input, Schema.Struct({ jobs: Schema.mutable(Schema.Array(job)).check(Schema.isMaxLength(4)) }), value => value.jobs.every(row => row.state === "queued")),
        // A grant always belongs to this request and acts as the bot
        start: input => call("start", input, Schema.Struct({ job, grant: Schema.optionalKey(publishingGrantSchema), remove: Schema.optionalKey(Schema.Struct({ channelId: id, messageId: id })) }),
            value => sameJob(input)(value) && (!value.grant || value.grant.source?.type === "showcase" && value.grant.source.jobId === input.jobId && value.grant.actorId === input.member.botId)) as Effect.Effect<C.ShowcaseStartResult, ShowcaseStoreError>,
        complete: input => call("complete", input, Schema.Struct({ job }), sameJob(input)),
        fail: input => call("fail", input, Schema.Null),
    }
}
