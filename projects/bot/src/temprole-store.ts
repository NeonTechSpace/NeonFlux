import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { fixSentence } from "./permission-fix.ts"

const integer = Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= 0))
const seconds = Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= 60 && v <= 365 * 86400))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/))
const epoch = Schema.String.check(Schema.makeFilter(v => v.length <= 64 && Number.isFinite(Date.parse(v))))
const problem = Schema.Literals(["permission", "role", "refused", "uncertain", "unavailable"])
const grant = Schema.Struct({ grantId: key, userId: id, roleId: id, joinedAt: epoch, endsAt: integer, grantedBy: id, createdAt: integer, updatedAt: integer, sourceId: key,
    problem: Schema.optionalKey(problem) })
const grants = Schema.mutable(Schema.Array(grant)).check(Schema.isMaxLength(25))
const state = { revision: integer, settings: Schema.Struct({ roles: Schema.mutable(Schema.Array(Schema.Struct({ roleId: id, defaultSeconds: Schema.optionalKey(seconds),
    maxSeconds: Schema.optionalKey(seconds) }))).check(Schema.isMaxLength(100)) }) }
export const temporaryRoleGrantSchema = grant

export class TemporaryRoleStoreError extends Data.TaggedError("TemporaryRoleStoreError")<{ readonly operation: string, readonly status: number | null, readonly code?: string }> {}
export interface TemporaryRoleStore {
    manage(input: C.TemporaryRoleManageRequest): Effect.Effect<C.TemporaryRoleManageResult, TemporaryRoleStoreError>
    query(input: C.TemporaryRoleQueryRequest): Effect.Effect<C.TemporaryRoleQueryResult, TemporaryRoleStoreError>
    work(input: C.TemporaryRoleWorkRequest): Effect.Effect<C.TemporaryRoleWorkResult, TemporaryRoleStoreError>
}
export function createTemporaryRoleStore(config: BackendConfig): TemporaryRoleStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean) => request(`/temproles/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new TemporaryRoleStoreError({ operation, status: null })),
        Effect.mapError(error => new TemporaryRoleStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null,
            ...("code" in error && typeof error.code === "string" ? { code: error.code } : {}) })))
    const answer = Schema.Union([Schema.Struct({ type: Schema.Literal("grant"), grant }), Schema.Struct({ type: Schema.Literal("settings"), ...state })])
    return {
        manage: input => call("manage", input, answer, value => {
            const op = input.operation
            return op.type === "role" ? value.type === "settings" : value.type === "grant" && value.grant.userId === op.userId && value.grant.roleId === op.roleId
        }) as Effect.Effect<C.TemporaryRoleManageResult, TemporaryRoleStoreError>,
        query: input => call("query", input, Schema.Union([Schema.Struct({ type: Schema.Literal("grants"), grants, nextCursor: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16384))) }),
            Schema.Struct({ type: Schema.Literal("settings"), ...state })]), value => {
            const op = input.operation
            return op.type === "settings" ? value.type === "settings" : value.type === "grants" && (op.userId === undefined || value.grants.every(row => row.userId === op.userId))
        }) as Effect.Effect<C.TemporaryRoleQueryResult, TemporaryRoleStoreError>,
        work: input => call("work", input, Schema.Union([Schema.Struct({ type: Schema.Literal("grants"), grants }), Schema.Struct({ type: Schema.Literal("recorded"), recorded: Schema.Boolean })]),
            value => (value.type === "grants") === (input.operation.type === "list")) as Effect.Effect<C.TemporaryRoleWorkResult, TemporaryRoleStoreError>,
    }
}

/** The sentence that says why a grant is not settled and what fixes it */
export function temporaryRoleProblemText(problem: C.TemporaryRoleProblem, roleId: string, prefix = "!") {
    switch (problem) {
        case "permission": return `${fixSentence({ permissions: ["ManageRoles"] })}. NeonFlux tries again within 10 minutes`
        case "role": return `${fixSentence({ roles: [roleId] })}, and keep the role free of staff permissions. NeonFlux tries again within 10 minutes`
        case "refused": return "Fluxer refused the role change. NeonFlux tries again within 10 minutes"
        case "uncertain": return `Fluxer did not confirm the last role change, so NeonFlux does not repeat it. An Administrator runs \`${prefix}temprole reconcile @member\``
        case "unavailable": return "NeonFlux could not read the member or the server's roles. It tries again within 10 minutes"
    }
}
export function temporaryRoleErrorMessage(error: TemporaryRoleStoreError) {
    if (error.code === "ACTOR_PERMISSION") return "You need Manage Roles to give temporary roles, and Manage Server to change role defaults"
    if (error.code === "ROLE_NOT_ELIGIBLE") return "Choose a role below the NeonFlux role and your own highest role, with only ordinary member permissions and not a staff role"
    if (error.code === "BOT_PERMISSION") return fixSentence({ permissions: ["ManageRoles"] })
    if (error.status === 400) return "Check the duration. Durations run from 1 minute to 365 days, such as 30m, 12h, 7d or 2w, and a role without a default needs one"
    if (error.status === 403) return "The member's current state, such as a timeout, quarantine, missing rules acknowledgment or the DEFCON level, does not allow this"
    if (error.status === 404) return "That member has no temporary grant of that role"
    if (error.status === 409) return "That member already holds the role or a temporary grant of it, or the grant changed. Check !temprole list @member"
    if (error.status === 429) return "That member holds 25 temporary roles, or 100 roles already have defaults"
    return "The temporary role change could not be confirmed. Check !temprole list before trying again"
}
