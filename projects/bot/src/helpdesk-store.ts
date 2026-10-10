import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min && v <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
export const helpDeskSettingsSchema = Schema.Struct({ forumIds: Schema.mutable(Schema.Array(id)).check(Schema.isMaxLength(10)), greeting: Schema.NullOr(text(500)), solvedTag: text(50),
    nudgeHours: Schema.NullOr(integer(1, 168)), guardChannelId: Schema.NullOr(id), autoArchive: Schema.Boolean, revision: integer() })
export const helpDeskAnswerSchema = Schema.Struct({ name: text(32), title: text(100), content: text(2000), updatedAt: integer() })
const manageSchema = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings: helpDeskSettingsSchema }), Schema.Struct({ type: Schema.Literal("answer"), answer: helpDeskAnswerSchema }),
    Schema.Struct({ type: Schema.Literal("answer-removed"), name: text(32) })])
const workSchema = Schema.Struct({ nudges: Schema.mutable(Schema.Array(Schema.Struct({ threadId: id, forumId: id }))).check(Schema.isMaxLength(25)), more: Schema.Boolean,
    guard: Schema.NullOr(Schema.Struct({ channelId: Schema.NullOr(id), autoArchive: Schema.Boolean, threshold: integer(1, 1000) })) })

export class HelpDeskStoreError extends Data.TaggedError("HelpDeskStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface HelpDeskStore {
    get(input: C.HelpDeskGetRequest): Effect.Effect<C.HelpDeskGetResult, HelpDeskStoreError>
    answers(input: C.HelpDeskAnswersRequest): Effect.Effect<C.HelpDeskAnswersResult, HelpDeskStoreError>
    manage(input: C.HelpDeskManageRequest): Effect.Effect<C.HelpDeskManageResult, HelpDeskStoreError>
    opened(input: C.HelpDeskOpenedRequest): Effect.Effect<C.HelpDeskOpenedResult, HelpDeskStoreError>
    work(input: C.HelpDeskWorkRequest): Effect.Effect<C.HelpDeskWorkResult, HelpDeskStoreError>
    guard(input: C.HelpDeskGuardRequest): Effect.Effect<C.HelpDeskGuardResult, HelpDeskStoreError>
}
export function createHelpDeskStore(config: BackendConfig): HelpDeskStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/helpdesk/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new HelpDeskStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        get: input => call("get", input, Schema.Struct({ settings: helpDeskSettingsSchema })),
        answers: input => call("answers", input, Schema.Struct({ answers: Schema.mutable(Schema.Array(helpDeskAnswerSchema)).check(Schema.isMaxLength(50)) })),
        manage: input => call("manage", input, manageSchema),
        opened: input => call("opened", input, Schema.Struct({ recorded: Schema.Boolean })),
        work: input => call("work", input, workSchema),
        guard: input => call("guard", input, Schema.Struct({ warn: Schema.Boolean })),
    }
}
