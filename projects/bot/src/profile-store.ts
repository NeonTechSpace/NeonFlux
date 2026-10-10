import type * as C from "@neonflux/backend/contracts"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { publishingContentSchema } from "./publishing-content.ts"
import { memberAccessSchema, memberJobSchema, memberLinksSchema } from "./showcase-store.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min && v <= max))
const operation = Schema.Struct({ type: Schema.Literal("save"), bio: Schema.String.check(Schema.isMaxLength(300)), links: memberLinksSchema, color: Schema.NullOr(integer(0, 0xffffff)) })
const job = memberJobSchema(operation)
const state = Schema.Struct({ revision: integer(), settings: Schema.Struct({ enabled: Schema.Boolean, cooldownSeconds: Schema.NullOr(integer(1, 3600)) }), access: memberAccessSchema })
const show = Schema.Union([Schema.Struct({ type: Schema.Literal("profile"), content: publishingContentSchema, cooldownSeconds: Schema.NullOr(integer(1, 3600)) }),
    Schema.Struct({ type: Schema.Literal("refused"), reason: Schema.Literals(["off", "access", "missing", "automod"]), rule: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))) })])

export class ProfileStoreError extends Data.TaggedError("ProfileStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface ProfileStore {
    manage(input: C.ProfileManageRequest): Effect.Effect<C.ProfileState, ProfileStoreError>
    settings(input: C.ProfileSettingsRequest): Effect.Effect<C.ProfileState, ProfileStoreError>
    show(input: C.ProfileShowRequest): Effect.Effect<C.ProfileShowResult, ProfileStoreError>
    ready(input: C.ProfileReadyRequest): Effect.Effect<C.ProfileReadyResult, ProfileStoreError>
    apply(input: C.ProfileApplyRequest): Effect.Effect<C.ProfileApplyResult, ProfileStoreError>
    fail(input: C.ProfileFailRequest): Effect.Effect<null, ProfileStoreError>
}
export function createProfileStore(config: BackendConfig): ProfileStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/profile/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new ProfileStoreError({ operation, status: null })),
        Effect.mapError(error => new ProfileStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, state),
        settings: input => call("settings", input, state),
        show: input => call("show", input, show) as Effect.Effect<C.ProfileShowResult, ProfileStoreError>,
        ready: input => call("ready", input, Schema.Struct({ jobs: Schema.mutable(Schema.Array(job)).check(Schema.isMaxLength(4)) }), value => value.jobs.every(row => row.state === "queued")),
        apply: input => call("apply", input, Schema.Struct({ job }), value => value.job.id === input.jobId),
        fail: input => call("fail", input, Schema.Null),
    }
}
