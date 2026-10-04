import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const statusSchema = Schema.Struct({
    userId: Schema.String,
    reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    since: Schema.Number.check(Schema.isFinite()),
})
const observationSchema = Schema.Struct({
    cleared: Schema.Boolean,
    statuses: Schema.Array(statusSchema).check(Schema.isMaxLength(5)),
})

export interface AfkStatus {
    readonly userId: string
    readonly reason: string
    readonly since: number
}

export class AfkStoreError extends Data.TaggedError("AfkStoreError")<{
    readonly operation: "set" | "observe"
}> {}

export interface AfkStore {
    readonly set: (userId: string, reason: string) => Effect.Effect<AfkStatus, AfkStoreError>
    readonly observe: (userId: string, mentionedUserIds: readonly string[]) => Effect.Effect<{
        readonly cleared: boolean
        readonly statuses: readonly AfkStatus[]
    }, AfkStoreError>
}

export function createAfkStore(config: BackendConfig, serverId: string): AfkStore {
    const post = createBackendRequest(config)
    function request(operation: "set" | "observe", values: Record<string, unknown>) {
        return post(`/afk/${operation}`, { serverId, ...values }).pipe(
            Effect.mapError(() => new AfkStoreError({ operation })),
        )
    }

    return {
        set: (userId, reason) => request("set", { userId, reason }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(statusSchema)),
            Effect.filterOrFail(
                (status) => status.userId === userId && status.reason === reason && status.since >= 0,
                () => new AfkStoreError({ operation: "set" }),
            ),
            Effect.mapError(() => new AfkStoreError({ operation: "set" })),
        ),
        observe: (userId, mentionedUserIds) => request("observe", { userId, mentionedUserIds }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(observationSchema)),
            Effect.filterOrFail(
                (result) => new Set(result.statuses.map((status) => status.userId)).size === result.statuses.length
                    && result.statuses.every((status) => snowflakes.isValid(status.userId)
                        && status.since >= 0 && mentionedUserIds.includes(status.userId)),
                () => new AfkStoreError({ operation: "observe" }),
            ),
            Effect.mapError(() => new AfkStoreError({ operation: "observe" })),
        ),
    }
}
