import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const integer = Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= 0))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/))
const name = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,31}$/))
const ids = (max: number) => Schema.mutable(Schema.Array(id)).check(Schema.isMaxLength(max), Schema.makeFilter(v => new Set(v).size === v.length))
const display = Schema.Struct({ roleId: id, name: Schema.String.check(Schema.isMaxLength(100)), color: integer.check(Schema.isLessThanOrEqualTo(0xffffff)) })
const menu = Schema.Struct({ name, description: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))), mode: Schema.Literals(["single", "multi"]), roleIds: ids(25),
    display: Schema.optionalKey(Schema.mutable(Schema.Array(display)).check(Schema.isMaxLength(25))) })
const access = Schema.Struct({ allowRoleIds: ids(100), blockRoleIds: ids(100), allowUserIds: ids(100), blockUserIds: ids(100) })
const state = Schema.Struct({ revision: integer, access, settings: Schema.Struct({ enabled: Schema.Boolean,
    menus: Schema.mutable(Schema.Array(menu)).check(Schema.isMaxLength(10), Schema.makeFilter(v => new Set(v.map(row => row.name)).size === v.length)) }) })
const memberOperation = Schema.Union([Schema.Struct({ type: Schema.Literals(["claim", "drop"]), menu: name, roleId: id }), Schema.Struct({ type: Schema.Literal("lookup") })])
export const rolePickerJobSchema = Schema.Struct({ id: key, actorId: id, operation: memberOperation, state: Schema.Literals(["queued", "applied", "failed"]), createdAt: integer, expiresAt: integer,
    error: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(512))) })

/** The server's role names and colors from a native read the bot already made, without the everyone role. The backend keeps menu roles only */
export function rolePickerDisplay(serverId: string, roles: readonly { id: string, name: string, color: number }[]): C.RolePickerRoleDisplay[] {
    return roles.filter(role => role.id !== serverId).map(role => ({ roleId: role.id, name: role.name.slice(0, 100), color: Number.isSafeInteger(role.color) && role.color >= 0 && role.color <= 0xffffff ? role.color : 0 }))
}
export class RolePickerStoreError extends Data.TaggedError("RolePickerStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface RolePickerStore {
    manage(input: C.RolePickerManageRequest): Effect.Effect<C.RolePickerState, RolePickerStoreError>
    settings(input: C.RolePickerQueryRequest): Effect.Effect<C.RolePickerState, RolePickerStoreError>
    ready(input: C.RolePickerReadyRequest): Effect.Effect<C.RolePickerReadyResult, RolePickerStoreError>
    start(input: C.RolePickerStartRequest): Effect.Effect<C.RolePickerStartResult, RolePickerStoreError>
    complete(input: C.RolePickerCompleteRequest): Effect.Effect<C.RolePickerCompleteResult, RolePickerStoreError>
    fail(input: C.RolePickerFailRequest): Effect.Effect<null, RolePickerStoreError>
}
export function createRolePickerStore(config: BackendConfig): RolePickerStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/rolepicker/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new RolePickerStoreError({ operation, status: null })),
        Effect.mapError(error => new RolePickerStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    const sameJob = (input: { jobId: string, actorId?: string }) => (value: { job: { id: string, actorId: string } }) => value.job.id === input.jobId && (input.actorId === undefined || value.job.actorId === input.actorId)
    return {
        manage: input => call("manage", input, state) as Effect.Effect<C.RolePickerState, RolePickerStoreError>,
        settings: input => call("settings", input, state) as Effect.Effect<C.RolePickerState, RolePickerStoreError>,
        ready: input => call("ready", input, Schema.Struct({ jobs: Schema.mutable(Schema.Array(rolePickerJobSchema)).check(Schema.isMaxLength(4)) }),
            value => new Set(value.jobs.map(job => job.id)).size === value.jobs.length && value.jobs.every(job => job.state === "queued")) as Effect.Effect<C.RolePickerReadyResult, RolePickerStoreError>,
        start: input => call("start", input, Schema.Struct({ proceed: Schema.Boolean, job: rolePickerJobSchema }), value => sameJob(input)(value) && (!value.proceed || value.job.state === "queued")) as Effect.Effect<C.RolePickerStartResult, RolePickerStoreError>,
        complete: input => call("complete", input, Schema.Struct({ job: rolePickerJobSchema }), sameJob(input)) as Effect.Effect<C.RolePickerCompleteResult, RolePickerStoreError>,
        fail: input => call("fail", input, Schema.Null),
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
