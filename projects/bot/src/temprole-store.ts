import {
    TEMPORARY_ROLE_DEFAULTS,
    TEMPORARY_ROLE_MEMBER_GRANTS,
    TemporaryRoleManageResult,
    TemporaryRoleQueryResult,
    TemporaryRoleWorkResult,
    type TemporaryRoleManageRequest,
    type TemporaryRoleProblem,
    type TemporaryRoleQueryRequest,
    type TemporaryRoleWorkRequest,
} from "@neonflux/contracts/temporary-roles"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest, failureFields, refusedReason } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { fixSentence } from "./permission-fix.ts"

export class TemporaryRoleStoreError extends Data.TaggedError("TemporaryRoleStoreError")<{
    readonly operation: string
    readonly status: number | null
    readonly code?: string
    readonly reason?: string
}> {}
export interface TemporaryRoleStore {
    manage(input: TemporaryRoleManageRequest): Effect.Effect<TemporaryRoleManageResult, TemporaryRoleStoreError>
    query(input: TemporaryRoleQueryRequest): Effect.Effect<TemporaryRoleQueryResult, TemporaryRoleStoreError>
    work(input: TemporaryRoleWorkRequest): Effect.Effect<TemporaryRoleWorkResult, TemporaryRoleStoreError>
}
export function createTemporaryRoleStore(config: BackendConfig): TemporaryRoleStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean) =>
        request(`/temproles/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.filterOrFail(matches, () => new TemporaryRoleStoreError({ operation, status: null })),
            Effect.mapError(
                (error) =>
                    new TemporaryRoleStoreError({
                        operation,
                        ...failureFields(error),
                    }),
            ),
        )
    return {
        manage: (input) =>
            call("manage", input, TemporaryRoleManageResult, (value) => {
                const op = input.operation
                return op.type === "role"
                    ? value.type === "settings"
                    : value.type === "grant" && value.grant.userId === op.userId && value.grant.roleId === op.roleId
            }),
        query: (input) =>
            call("query", input, TemporaryRoleQueryResult, (value) => {
                const op = input.operation
                return op.type === "settings"
                    ? value.type === "settings"
                    : value.type === "grants" &&
                          (op.userId === undefined || value.grants.every((row) => row.userId === op.userId))
            }),
        work: (input) =>
            call(
                "work",
                input,
                TemporaryRoleWorkResult,
                (value) => (value.type === "grants") === (input.operation.type === "list"),
            ),
    }
}

/**
 * The sentence that says why a grant is not settled and what fixes it. NeonFlux tries again only once a grant has
 * ended, so a problem that cannot be retried leaves that promise out
 */
export function temporaryRoleProblemText(problem: TemporaryRoleProblem, roleId: string, prefix = "!", retries = true) {
    switch (problem) {
        case "permission":
            return `${fixSentence({ permissions: ["ManageRoles"] })}${retries ? ". NeonFlux tries again within 10 minutes" : ""}`
        case "role":
            return `${fixSentence({ roles: [roleId] })}, and keep the role free of staff permissions${retries ? ". NeonFlux tries again within 10 minutes" : ""}`
        case "refused":
            return `Fluxer refused the role change${retries ? ". NeonFlux tries again within 10 minutes" : ""}`
        case "uncertain":
            return `Fluxer did not confirm the last role change, so NeonFlux does not repeat it. An Administrator runs \`${prefix}temprole reconcile @member\``
        case "unavailable":
            return `NeonFlux could not read the member or the server's roles${retries ? ". It tries again within 10 minutes" : ""}`
    }
}
export function temporaryRoleErrorMessage(error: TemporaryRoleStoreError) {
    const refused = refusedReason(error)
    if (refused) return refused
    if (error.code === "ACTOR_PERMISSION")
        return "You need Manage roles to give temporary roles, and Manage community to change role defaults"
    if (error.code === "ROLE_NOT_ELIGIBLE")
        return "Choose a role below the NeonFlux role and your own highest role, with only ordinary member permissions and not a staff role"
    if (error.code === "BOT_PERMISSION") return fixSentence({ permissions: ["ManageRoles"] })
    if (error.status === 400)
        return "Check the duration. Durations run from 1 minute to 365 days, such as 30m, 12h, 7d or 2w, and a role without a default needs one"
    if (error.status === 403)
        return "The member's current state, such as a timeout, quarantine, missing rules acknowledgment or the DEFCON level, does not allow this"
    if (error.status === 404) return "That member has no temporary grant of that role"
    if (error.status === 409)
        return "That member already holds the role or a temporary grant of it, or the grant changed. Check !temprole list @member"
    if (error.status === 429)
        return `That member holds ${TEMPORARY_ROLE_MEMBER_GRANTS} temporary roles, or ${TEMPORARY_ROLE_DEFAULTS} roles already have defaults`
    return "The temporary role change could not be confirmed. Check !temprole list before trying again"
}
