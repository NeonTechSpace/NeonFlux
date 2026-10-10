import { ProfileApplyResult, ProfileFailResult, ProfileReadyResult, ProfileShowResult, ProfileState, type ProfileApplyRequest, type ProfileFailRequest, type ProfileManageRequest, type ProfileReadyRequest,
    type ProfileSettingsRequest, type ProfileShowRequest } from "@neonflux/contracts/profiles"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class ProfileStoreError extends Data.TaggedError("ProfileStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface ProfileStore {
    manage(input: ProfileManageRequest): Effect.Effect<ProfileState, ProfileStoreError>
    settings(input: ProfileSettingsRequest): Effect.Effect<ProfileState, ProfileStoreError>
    show(input: ProfileShowRequest): Effect.Effect<ProfileShowResult, ProfileStoreError>
    ready(input: ProfileReadyRequest): Effect.Effect<ProfileReadyResult, ProfileStoreError>
    apply(input: ProfileApplyRequest): Effect.Effect<ProfileApplyResult, ProfileStoreError>
    fail(input: ProfileFailRequest): Effect.Effect<ProfileFailResult, ProfileStoreError>
}
export function createProfileStore(config: BackendConfig): ProfileStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/profile/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new ProfileStoreError({ operation, status: null })),
        Effect.mapError(error => new ProfileStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, ProfileState),
        settings: input => call("settings", input, ProfileState),
        show: input => call("show", input, ProfileShowResult),
        ready: input => call("ready", input, ProfileReadyResult, value => value.jobs.every(row => row.state === "queued")),
        apply: input => call("apply", input, ProfileApplyResult, value => value.job.id === input.jobId),
        fail: input => call("fail", input, ProfileFailResult),
    }
}
