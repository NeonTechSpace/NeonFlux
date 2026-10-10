import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { publishingContentSchema } from "./publishing-content.ts"
import { publishingGrantSchema } from "./publishing-store.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min && v <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
const optional = Schema.optionalKey
const youtubeChannelId = Schema.String.check(Schema.isPattern(/^UC[A-Za-z0-9_-]{22}$/))
const videoId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{11}$/))
const status = Schema.Struct({ title: optional(text(256)), subscribedUntil: optional(integer()), hubError: optional(text(300)), lastNotificationAt: optional(integer()), lastPostAt: optional(integer()),
    latestVideo: optional(Schema.Struct({ videoId, title: text(1000), publishedAt: Schema.Number })) })
export const youtubeSubscriptionSchema = Schema.Struct({ youtubeChannelId, channelId: id, enabled: Schema.Boolean, problem: optional(Schema.Literals(["channel", "permission"])), createdAt: integer(), status })
const view = { configured: Schema.Boolean, subscriptions: Schema.mutable(Schema.Array(youtubeSubscriptionSchema)).check(Schema.isMaxLength(10)) }
const querySchema = Schema.Struct({ ...view, sample: optional(Schema.Struct({ channelId: id, content: publishingContentSchema, forumPostName: text(100) })) })
const manageSchema = Schema.Struct({ type: Schema.Literals(["added", "removed"]), subscription: youtubeSubscriptionSchema })
const workSchema = Schema.Union([
    Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: Schema.mutable(Schema.Array(Schema.Struct({ youtubeChannelId, videoId, channelId: id }))).check(Schema.isMaxLength(10)) }),
    Schema.Struct({ type: Schema.Literal("reserved"), grant: publishingGrantSchema }), Schema.Struct({ type: Schema.Literal("skipped") }), Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean }),
])

export class YoutubeStoreError extends Data.TaggedError("YoutubeStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface YoutubeStore {
    query(input: C.YoutubeQueryRequest): Effect.Effect<C.YoutubeQueryResult, YoutubeStoreError>
    manage(input: C.YoutubeManageRequest): Effect.Effect<C.YoutubeManageResult, YoutubeStoreError>
    work(input: C.YoutubeWorkRequest): Effect.Effect<C.YoutubeWorkResult, YoutubeStoreError>
}
export function createYoutubeStore(config: BackendConfig): YoutubeStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/youtube/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new YoutubeStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        query: input => call("query", input, querySchema) as Effect.Effect<C.YoutubeQueryResult, YoutubeStoreError>,
        manage: input => call("manage", input, manageSchema) as Effect.Effect<C.YoutubeManageResult, YoutubeStoreError>,
        work: input => call("work", input, workSchema) as Effect.Effect<C.YoutubeWorkResult, YoutubeStoreError>,
    }
}
