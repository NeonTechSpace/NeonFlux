import { RolePickerCompleteResult, RolePickerFailResult, RolePickerReadyResult, RolePickerStartResult, RolePickerState, type RolePickerCompleteRequest, type RolePickerFailRequest,
    type RolePickerManageRequest, type RolePickerQueryRequest, type RolePickerReadyRequest, type RolePickerRoleDisplay, type RolePickerStartRequest } from "@neonflux/contracts/role-picker"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

/** The server's role names and colors from a native read the bot already made, without the everyone role. The backend keeps menu roles only */
export function rolePickerDisplay(serverId: string, roles: readonly { id: string, name: string, color: number }[]): RolePickerRoleDisplay[] {
    return roles.filter(role => role.id !== serverId).map(role => ({ roleId: role.id, name: role.name.slice(0, 100), color: Number.isSafeInteger(role.color) && role.color >= 0 && role.color <= 0xffffff ? role.color : 0 }))
}
export class RolePickerStoreError extends Data.TaggedError("RolePickerStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface RolePickerStore {
    manage(input: RolePickerManageRequest): Effect.Effect<RolePickerState, RolePickerStoreError>
    settings(input: RolePickerQueryRequest): Effect.Effect<RolePickerState, RolePickerStoreError>
    ready(input: RolePickerReadyRequest): Effect.Effect<RolePickerReadyResult, RolePickerStoreError>
    start(input: RolePickerStartRequest): Effect.Effect<RolePickerStartResult, RolePickerStoreError>
    complete(input: RolePickerCompleteRequest): Effect.Effect<RolePickerCompleteResult, RolePickerStoreError>
    fail(input: RolePickerFailRequest): Effect.Effect<RolePickerFailResult, RolePickerStoreError>
}
export function createRolePickerStore(config: BackendConfig): RolePickerStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/rolepicker/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new RolePickerStoreError({ operation, status: null })),
        Effect.mapError(error => new RolePickerStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    const sameJob = (input: { jobId: string, actorId?: string }) => (value: { job: { id: string, actorId: string } }) => value.job.id === input.jobId && (input.actorId === undefined || value.job.actorId === input.actorId)
    return {
        manage: input => call("manage", input, RolePickerState),
        settings: input => call("settings", input, RolePickerState),
        ready: input => call("ready", input, RolePickerReadyResult, value => new Set(value.jobs.map(job => job.id)).size === value.jobs.length && value.jobs.every(job => job.state === "queued")),
        start: input => call("start", input, RolePickerStartResult, value => sameJob(input)(value) && (!value.proceed || value.job.state === "queued")),
        complete: input => call("complete", input, RolePickerCompleteResult, sameJob(input)),
        fail: input => call("fail", input, RolePickerFailResult),
    }
}
export function rolePickerErrorMessage(error: RolePickerStoreError) {
    if (error.status === 403) return "Only the server owner or an administrator can change the role picker, and only one current server's roles qualify. At DEFCON 1 only turning it off or removing a menu works"
    if (error.status === 404) return "That menu was not found. Use !rolepicker menu list"
    if (error.status === 409) return "That conflicts with the current menus. A role can belong to one menu, menu names are unique, and a chat change older than a dashboard change is refused"
    if (error.status === 429) return "The menu limit was reached. A server can have 10 menus"
    if (error.status === 400) return "Check the command. Menus hold at most 25 roles, descriptions have up to 200 characters and access lists hold up to 100 entries each"
    return "The role picker settings could not be read or saved. Try again shortly"
}
