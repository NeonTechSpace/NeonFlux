import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { publishingContentSchema } from "./publishing-content.ts"
import { isDeepStrictEqual } from "node:util"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= min && n <= max))
const id = Schema.String.check(Schema.makeFilter((v) => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.makeFilter((v) => v.length > 0 && v.length <= 256))
const cursor = Schema.String.check(Schema.makeFilter((v) => v.length > 0 && v.length <= 4096))
const name = Schema.String.check(Schema.makeFilter((v) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)))
const epoch = Schema.String.check(Schema.makeFilter((v) => v.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))))
const optional = Schema.optionalKey
const list = <A>(schema: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(max))
const ids = (max: number) => list(id, max).check(Schema.makeFilter((v) => new Set(v).size === v.length))
export const rolesReservationsSchema = list(Schema.Struct({ userId: id, roleIds: ids(20).check(Schema.isMinLength(1)) }), 100)
    .check(Schema.makeFilter(v => new Set(v.map(row => row.userId)).size === v.length))
const settings = Schema.Struct({ panelsEnabled: Schema.Boolean, verificationEnabled: Schema.Boolean, autoroleEnabled: Schema.Boolean, humansOnly: Schema.Boolean,
    autoroleIds: ids(20), reservations: optional(rolesReservationsSchema), revision: integer(1) })
const mapping = Schema.Struct({ emoji: key, roleId: id, prerequisiteRoleIds: ids(20), exclusionRoleIds: ids(20) })
const mappings = list(mapping, 20).check(Schema.makeFilter((v) => new Set(v.map((m) => m.emoji)).size === v.length && new Set(v.map((m) => m.roleId)).size === v.length))
export const rolesMappingsSchema = mappings
const snapshot = Schema.Struct({ revision: integer(1), publishedAt: integer(), postNo: integer(1), postGeneration: integer(1), channelId: id, messageId: id, botId: id,
    content: publishingContentSchema, mappings, exclusive: Schema.Boolean })
const panel = Schema.Struct({ name, kind: Schema.Literals(["reaction", "verification"]), revision: integer(1), enabled: Schema.Boolean,
    exclusive: Schema.Boolean, mappings, published: optional(snapshot), withdrawing: Schema.Boolean }).check(Schema.makeFilter((v) => !v.published || v.published.revision <= v.revision))
const grantFields = { attemptId: key, ownershipId: key, generation: integer(1), sourceId: key, action: Schema.Literals(["add", "remove"]),
    userId: id, joinedAt: epoch, roleId: id, botId: id, expectedPresent: Schema.Boolean, consumerKey: key,
    dispatchExpiresAt: integer(1), nativeDeadlineMs: Schema.Literal(5000) }
const grant = Schema.Struct(grantFields).check(Schema.makeFilter((v) => v.expectedPresent === (v.action === "remove")))
const attempt = Schema.Struct({ ...grantFields, outcome: Schema.Literals(["pending", "succeeded", "failed", "uncertain"]), createdAt: integer(),
    finishedAt: optional(integer()), noDispatch: optional(Schema.Literal(true)), dispatchedAt: optional(integer()) }).check(Schema.makeFilter((v) =>
        v.expectedPresent === (v.action === "remove") && v.dispatchExpiresAt === v.createdAt + 180000
        && (v.finishedAt === undefined || v.finishedAt >= v.createdAt)
        && (v.dispatchedAt === undefined || v.dispatchedAt >= v.createdAt && v.dispatchedAt < v.dispatchExpiresAt)
        && (!v.noDispatch || v.outcome === "failed" && v.dispatchedAt === undefined)))
const claim = Schema.Struct({ ownershipId: key, userId: id, joinedAt: epoch, roleId: id, generation: integer(), owned: Schema.Boolean,
    status: Schema.Literals(["idle", "pending", "uncertain"]), consumerKeys: list(key, 100), attempt: optional(attempt) }).check(Schema.makeFilter((v) =>
        (v.generation !== 0 || !v.owned && v.status === "idle" && v.attempt === undefined)
        && (!v.attempt || v.attempt.ownershipId === v.ownershipId && v.attempt.userId === v.userId && v.attempt.joinedAt === v.joinedAt
            && v.attempt.roleId === v.roleId && v.attempt.generation === v.generation)))
const acknowledgment = Schema.Struct({ acknowledged: Schema.Boolean, rulesRevision: optional(integer(1)), acknowledgedAt: optional(integer()),
    accessConfirmed: Schema.Boolean, accessRolePresent: Schema.Boolean })
const commandOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("choose"), name, revision: integer(1), roleId: id, selected: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("verify"), name, revision: integer(1), messageId: optional(id), panelVerified: optional(Schema.Boolean), reactionPresent: optional(Schema.Boolean) }),
    Schema.Struct({ type: Schema.Literal("withdraw-member"), consumerKey: key, roleId: id }),
])
const withdrawal = Schema.Struct({ withdrawalId: key, consumerKey: key, step: integer(1), status: Schema.Literals(["pending", "blocked", "complete"]), remainingAtLeast: integer(), hasMore: Schema.Boolean, deletePanel: Schema.Boolean,
    targets: list(Schema.Struct({ userId: id, joinedAt: epoch, roleId: id }), 10), nextCursor: optional(cursor) }).check(Schema.makeFilter((v) => v.remainingAtLeast >= v.targets.length
        && (v.status !== "complete" || v.remainingAtLeast === 0 && !v.hasMore && v.targets.length === 0)))
const reactionJob = Schema.Struct({ jobId: key, name, revision: integer(1), messageId: id, channelId: id, generation: integer(), pageStep: integer(),
    status: Schema.Literals(["queued", "running", "blocked", "complete", "cancelled"]), rerun: Schema.Boolean, leaseExpiresAt: optional(integer(1)) })
const reactionJobs = Schema.Union([
    Schema.Struct({ type: Schema.Literal("jobs"), jobs: list(reactionJob, 51) }),
    Schema.Struct({ type: Schema.Literal("job"), job: reactionJob }),
    Schema.Struct({ type: Schema.Literal("page"), claimed: Schema.Literal(false), job: reactionJob }),
    Schema.Struct({ type: Schema.Literal("page"), claimed: Schema.Literal(true), job: reactionJob,
        targets: list(Schema.Struct({ userId: id, joinedAt: epoch, sourceId: key }), 10), hasMore: Schema.Boolean }),
])
const manage = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("panel"), panel }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("withdrawal"), withdrawal })])
export const rolesManageSchema = manage
const query = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings }), Schema.Struct({ type: Schema.Literal("panel"), panel }),
    Schema.Struct({ type: Schema.Literal("panels"), panels: list(panel, 10), page: integer(1), totalPages: integer(1) }),
    Schema.Struct({ type: Schema.Literal("claims"), claims: list(claim, 10), nextCursor: optional(cursor) }),
    Schema.Struct({ type: Schema.Literal("attempt"), attempt }), Schema.Struct({ type: Schema.Literal("withdrawal"), withdrawal }),
    Schema.Struct({ type: Schema.Literal("configurations"), references: list(Schema.Struct({ consumerKey: key, roleId: id, postNo: optional(integer(1)) }), 10), nextCursor: optional(cursor) })])

export class RolesStoreError extends Data.TaggedError("RolesStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface RolesStore {
    manage(input: C.RolesManageRequest): Effect.Effect<C.RolesManageResult, RolesStoreError>
    query(input: C.RolesQueryRequest): Effect.Effect<C.RolesQueryResult, RolesStoreError>
    memberQuery(input: C.RolesMemberQueryRequest): Effect.Effect<C.RolesMemberQueryResult, RolesStoreError>
    policy(input: C.RolesPolicyRequest): Effect.Effect<C.RolesPolicyResult, RolesStoreError>
    reactionJobs(input: C.RolesReactionJobsRequest): Effect.Effect<C.RolesReactionJobsResult, RolesStoreError>
    evaluate(input: C.RolesEvaluateRequest): Effect.Effect<C.RolesEvaluateResult, RolesStoreError>
    dispatch(input: C.RolesDispatchRequest): Effect.Effect<C.RolesDispatchResult, RolesStoreError>
    outcome(input: C.RolesOutcomeRequest): Effect.Effect<C.RolesOutcomeResult, RolesStoreError>
    reconcile(input: C.RolesReconcileRequest): Effect.Effect<C.RolesReconcileResult, RolesStoreError>
    observe(input: C.RolesObserveRequest): Effect.Effect<C.RolesObserveResult, RolesStoreError>
}
export function createRolesStore(config: BackendConfig): RolesStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/roles/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new RolesStoreError({ operation, status: null })),
        Effect.mapError((error) => new RolesStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        reactionJobs: (input) => call("reaction-jobs", input, reactionJobs, (value) => {
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
        policy: (input) => call("policy", input, Schema.Struct({ settings })),
        manage: (input) => call("manage", input, manage, (result) => {
            if (result.duplicate) return true
            const op = input.operation
            if (op.type === "settings") return result.type === "settings" && Object.entries(op.patch).every(([key, value]) => JSON.stringify(value) === JSON.stringify(result.settings[key as keyof C.RolesSettings]))
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
        query: (input) => call("query", input, query, (result) => {
            const op = input.operation
            if (op.type === "settings") return result.type === "settings"
            if (op.type === "panel-show") return result.type === "panel" && result.panel.name === op.name
            if (op.type === "panel-list") return result.type === "panels" && result.page === (op.page ?? 1) && result.page <= result.totalPages
            if (op.type === "attempt-show") return result.type === "attempt" && result.attempt.attemptId === op.attemptId
            if (op.type === "withdrawal-show") return result.type === "withdrawal" && result.withdrawal.withdrawalId === op.withdrawalId
            if (op.type === "configuration-list") return result.type === "configurations" && result.references.every((r) => !op.name || r.consumerKey.startsWith(`panel:${op.name}:`))
            return result.type === "claims" && result.claims.every((v) => v.userId === op.userId && v.joinedAt === op.joinedAt)
        }),
        memberQuery: (input) => call("member-query", input, Schema.Struct({ settings, panels: list(panel, 51).check(Schema.makeFilter((v) => v.filter((p) => p.kind === "verification").length <= 1
            && v.filter((p) => p.kind === "reaction").length <= 50 && new Set(v.map((p) => p.name)).size === v.length)), acknowledgment })),
        evaluate: (input) => call("evaluate", input, Schema.Struct({ duplicate: Schema.Boolean, status: Schema.Literals(["unchanged", "acknowledged", "reserved", "partial", "ambiguous", "blocked"]), acknowledgment, grant: optional(grant) }),
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
                return op.type === "join" && value.action === "add" && /^autorole:[1-9]\d*$/.test(value.consumerKey)
            }),
        dispatch: (input) => call("dispatch", input, Schema.Struct({ claimed: Schema.Boolean, dispatchExpiresAt: integer(1), nativeDeadlineMs: Schema.Literal(5000) })),
        outcome: (input) => call("outcome", input, Schema.Struct({ recorded: Schema.Boolean })),
        reconcile: (input) => call("reconcile", input, Schema.Struct({ recorded: Schema.Boolean, claim }), (result) => result.claim.userId === input.observation.userId
            && result.claim.joinedAt === input.observation.joinedAt && result.claim.roleId === input.observation.roleId && result.claim.generation === input.generation
            && result.claim.attempt?.attemptId === input.attemptId),
        observe: (input) => call("observe", input, Schema.Struct({ uncertainAttempts: integer() })),
    }
}

export function rolesErrorMessage(error: RolesStoreError) {
    if (error.status === 403) return "Your current membership, permissions, verification, quarantine, module, or DEFCON state does not allow this operation"
    if (error.status === 404) return "That panel, claim, or attempt was not found"
    if (error.status === 409) return "The panel, membership, or managed state changed. Inspect it before continuing"
    if (error.status === 429) return "The role configuration or receipt capacity was reached"
    return "I couldn't confirm the role operation. Inspect its status before attempting another change"
}
