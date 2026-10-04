import { AfkObserveResult, AfkStatus, type AfkObserveRequest, type AfkSetRequest } from "@neonflux/contracts/afk"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class AfkStoreError extends Data.TaggedError("AfkStoreError")<{
    readonly operation: "set" | "observe"
}> {}

export interface AfkStore {
    readonly set: (userId: string, reason: string) => Effect.Effect<AfkStatus, AfkStoreError>
    readonly observe: (userId: string, mentionedUserIds: readonly string[]) => Effect.Effect<AfkObserveResult, AfkStoreError>
}

export function createAfkStore(config: BackendConfig, serverId: string): AfkStore {
    const post = createBackendRequest(config)
    function request(operation: "set" | "observe", body: AfkSetRequest | AfkObserveRequest) {
        return post(`/afk/${operation}`, body).pipe(
            Effect.mapError(() => new AfkStoreError({ operation })),
        )
    }

    return {
        set: (userId, reason) => request("set", { serverId, userId, reason }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(AfkStatus)),
            Effect.filterOrFail(
                (status) => status.userId === userId && status.reason === reason,
                () => new AfkStoreError({ operation: "set" }),
            ),
            Effect.mapError(() => new AfkStoreError({ operation: "set" })),
        ),
        observe: (userId, mentionedUserIds) => request("observe", { serverId, userId, mentionedUserIds: [...mentionedUserIds] }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(AfkObserveResult)),
            Effect.filterOrFail(
                (result) => result.statuses.every((status) => mentionedUserIds.includes(status.userId)),
                () => new AfkStoreError({ operation: "observe" }),
            ),
            Effect.mapError(() => new AfkStoreError({ operation: "observe" })),
        ),
    }
}
