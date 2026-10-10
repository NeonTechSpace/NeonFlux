import { RolesDispatchResult, RolesEvaluateResult, RolesManageResult, RolesMemberQueryResult, RolesObserveResult, RolesOutcomeResult, RolesPolicyResult, RolesQueryResult,
    RolesReactionJobsResult, RolesReconcileResult, type RolesDispatchRequest, type RolesEvaluateRequest, type RolesManageRequest, type RolesMemberQueryRequest,
    type RolesObserveRequest, type RolesOutcomeRequest, type RolesPolicyRequest, type RolesQueryRequest, type RolesReactionJobsRequest, type RolesReconcileRequest, type RolesSettings } from "@neonflux/contracts/roles"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { fixSentence } from "./permission-fix.ts"


export class RolesStoreError extends Data.TaggedError("RolesStoreError")<{ readonly operation: string, readonly status: number | null, readonly code?: string }> {}
export interface RolesStore {
    manage(input: RolesManageRequest): Effect.Effect<RolesManageResult, RolesStoreError>
    query(input: RolesQueryRequest): Effect.Effect<RolesQueryResult, RolesStoreError>
    memberQuery(input: RolesMemberQueryRequest): Effect.Effect<RolesMemberQueryResult, RolesStoreError>
    policy(input: RolesPolicyRequest): Effect.Effect<RolesPolicyResult, RolesStoreError>
    reactionJobs(input: RolesReactionJobsRequest): Effect.Effect<RolesReactionJobsResult, RolesStoreError>
    evaluate(input: RolesEvaluateRequest): Effect.Effect<RolesEvaluateResult, RolesStoreError>
    dispatch(input: RolesDispatchRequest): Effect.Effect<RolesDispatchResult, RolesStoreError>
    outcome(input: RolesOutcomeRequest): Effect.Effect<RolesOutcomeResult, RolesStoreError>
    reconcile(input: RolesReconcileRequest): Effect.Effect<RolesReconcileResult, RolesStoreError>
    observe(input: RolesObserveRequest): Effect.Effect<RolesObserveResult, RolesStoreError>
}
export function createRolesStore(config: BackendConfig): RolesStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/roles/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new RolesStoreError({ operation, status: null })),
        Effect.mapError((error) => new RolesStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null, ...("code" in error && error.code ? { code: error.code } : {}) })))
    return {
        reactionJobs: (input) => call("reaction-jobs", input, RolesReactionJobsResult, (value) => {
            const op = input.operation
            if (op.type === "list") return value.type === "jobs" && new Set(value.jobs.map((j) => j.jobId)).size === value.jobs.length
                && new Set(value.jobs.map((j) => j.name)).size === value.jobs.length
            if (value.type === "jobs") return false
            if (op.type === "enqueue") return value.type === "job" && value.job.messageId === op.messageId
            const binding = op.type === "skip" || op.type === "block" ? op.binding : op
            if (value.job.jobId !== binding.jobId) return false
            if (op.type === "skip" || op.type === "block") return value.type === "job" && value.job.generation === op.binding.generation && value.job.pageStep === op.binding.pageStep
            if (op.type === "checkpoint") return value.type === "job" && value.job.generation === op.generation && value.job.pageStep === op.pageStep
            if (value.type === "job") return value.job.status === "cancelled"
            return value.type === "page" && (!value.claimed || value.job.status === "running" && value.job.generation > 0 && value.job.pageStep > 0 && value.job.leaseExpiresAt !== undefined
                && new Set(value.targets.map((t) => `${t.userId}:${t.joinedAt}`)).size === value.targets.length
                && value.targets.every((t, index) => t.sourceId === `job_${value.job.jobId}_${value.job.generation}_${value.job.pageStep}_${index}`))
        }),
        policy: (input) => call("policy", input, RolesPolicyResult),
        manage: (input) => call("manage", input, RolesManageResult, (result) => {
            if (result.duplicate) return true
            const op = input.operation
            if (op.type === "settings") return result.type === "settings" && Object.entries(op.patch).every(([key, value]) => JSON.stringify(value) === JSON.stringify(result.settings[key as keyof RolesSettings]))
            if (op.type === "withdraw" || op.type === "withdraw-next" || op.type === "withdraw-departed" || op.type === "autorole-withdraw") return result.type === "withdrawal"
                && (!('withdrawalId' in op) || result.withdrawal.withdrawalId === op.withdrawalId)
                && (op.type !== "withdraw" || result.withdrawal.consumerKey === `panel:${op.name}:${op.revision}` && result.withdrawal.deletePanel === (op.deletePanel ?? false))
                && (op.type !== "autorole-withdraw" || result.withdrawal.consumerKey === `autorole:${op.revision}`)
                && (op.type !== "withdraw-next" || result.withdrawal.step === op.expectedStep + 1)
            return result.type === "panel" && result.panel.name === op.name && (op.type !== "panel-create" || result.panel.kind === op.kind)
                && (op.type !== "panel-update" || (op.patch.mappings !== undefined || op.patch.exclusive !== undefined
                    ? result.panel.revision > op.expectedRevision : result.panel.revision === op.expectedRevision))
                && (op.type !== "panel-bind" || result.panel.published?.revision === op.expectedRevision && result.panel.published.postNo === op.postNo && result.panel.published.postGeneration === op.expectedPostGeneration)
        }),
        query: (input) => call("query", input, RolesQueryResult, (result) => {
            const op = input.operation
            if (op.type === "settings") return result.type === "settings"
            if (op.type === "panel-show") return result.type === "panel" && result.panel.name === op.name
            if (op.type === "panel-list") return result.type === "panels" && result.page === (op.page ?? 1) && result.page <= result.totalPages
            if (op.type === "attempt-show") return result.type === "attempt" && result.attempt.attemptId === op.attemptId
            if (op.type === "withdrawal-show") return result.type === "withdrawal" && result.withdrawal.withdrawalId === op.withdrawalId
            if (op.type === "withdrawal-open") return result.type === "withdrawal" && result.withdrawal.status !== "complete" && result.withdrawal.consumerKey.startsWith(op.name ? `panel:${op.name}:` : "autorole:")
            if (op.type === "configuration-list") return result.type === "configurations" && result.references.every((r) => !op.name || r.consumerKey.startsWith(`panel:${op.name}:`))
            return result.type === "claims" && result.claims.every((v) => v.userId === op.userId && v.joinedAt === op.joinedAt)
        }),
        memberQuery: (input) => call("member-query", input, RolesMemberQueryResult),
        evaluate: (input) => call("evaluate", input, RolesEvaluateResult,
            (result) => {
                const value = result.grant, op = input.operation
                if (!value) return !["reserved", "partial"].includes(result.status)
                if (result.duplicate || !["reserved", "partial"].includes(result.status) || value.sourceId !== input.sourceId
                    || value.userId !== input.context.userId || value.joinedAt !== input.context.joinedAt || value.botId !== input.context.botId
                    || !input.context.roles.some((r) => r.roleId === value.roleId) || input.context.roleIds.includes(value.roleId) !== value.expectedPresent) return false
                if (op.type === "choose" || op.type === "reaction" || op.type === "verify") {
                    if (value.consumerKey !== `panel:${op.name}:${op.revision}`) return false
                    if (op.type === "choose") return op.selected ? value.action === "remove" && result.status === "partial" && value.roleId !== op.roleId
                        || value.action === "add" && value.roleId === op.roleId : value.action === "remove" && value.roleId === op.roleId
                    return op.type !== "verify" || value.action === "add"
                }
                if (op.type === "withdraw" || op.type === "withdraw-member") return value.action === "remove" && value.roleId === op.roleId
                    && (op.type !== "withdraw-member" || value.consumerKey === op.consumerKey)
                if (op.type === "level-sync") return value.consumerKey === "level" && value.roleId === op.roleId
                if (op.type === "temporary") return value.consumerKey === "temporary" && value.roleId === op.roleId
                if (op.type === "onboarding") return value.consumerKey === "onboarding" && value.roleId === op.roleId && value.action === "add"
                // A single-choice claim first releases another role of the same menu, like an exclusive panel choice
                if (op.type === "pick") return value.consumerKey === `picker:${op.menu}` && value.sourceId === `picker_${op.jobId}` && (op.selected
                    ? value.action === "add" && value.roleId === op.roleId || value.action === "remove" && result.status === "partial" && value.roleId !== op.roleId
                    : value.action === "remove" && value.roleId === op.roleId)
                return op.type === "join" && value.action === "add" && /^autorole:[1-9]\d*$/.test(value.consumerKey)
            }),
        dispatch: (input) => call("dispatch", input, RolesDispatchResult),
        outcome: (input) => call("outcome", input, RolesOutcomeResult),
        reconcile: (input) => call("reconcile", input, RolesReconcileResult, (result) => result.claim.userId === input.observation.userId
            && result.claim.joinedAt === input.observation.joinedAt && result.claim.roleId === input.observation.roleId && result.claim.generation === input.generation
            && result.claim.attempt?.attemptId === input.attemptId),
        observe: (input) => call("observe", input, RolesObserveResult),
    }
}

export function rolesErrorMessage(error: RolesStoreError) {
    if (error.code === "BOT_PERMISSION") return fixSentence({ permissions: ["ManageRoles"] })
    if (error.code === "ROLE_NOT_ELIGIBLE") return "Choose a role below the NeonFlux role and your own highest role, with only ordinary member permissions and not a staff role"
    if (error.status === 403) return "Your current membership, permissions, verification, quarantine, module, or DEFCON state does not allow this operation"
    if (error.status === 404) return "That panel or role change was not found"
    if (error.status === 409) return "The panel or your roles changed while this command ran. Check them, then send the command again"
    if (error.status === 429) return "This server has reached its limit for role settings or recent role changes. Try again later"
    return "NeonFlux couldn't confirm the role change. Check the current roles before you try again"
}
