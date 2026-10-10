import { AppealMemberResult, AppealStaffResult, type AppealMemberRequest, type AppealStaffRequest } from "@neonflux/contracts/appeal"
import { AutomodRuleType, ModerationDispatchResult, ModerationEvaluateResult, ModerationGateResult, ModerationJoinResult, ModerationLogOutcomeResult, ModerationManageResult,
    ModerationNoticeOutcomeResult, ModerationObserveResult, ModerationOutcomeResult, ModerationQueryResult, ModerationReconcileResult, type ModerationActionGrant, type ModerationCase,
    type ModerationDispatchRequest, type ModerationEvaluateRequest, type ModerationGateRequest, type ModerationJoinRequest, type ModerationLogOutcomeRequest, type ModerationManageRequest,
    type ModerationNoticeOutcomeRequest, type ModerationObserveRequest, type ModerationOutcomeRequest, type ModerationQueryRequest, type ModerationReconcileRequest } from "@neonflux/contracts/moderation"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export const automodRuleTypes = AutomodRuleType.literals

export class ModerationStoreError extends Data.TaggedError("ModerationStoreError")<{ readonly operation: string, readonly status: number | null, readonly code?: string }> {}
export interface ModerationStore {
    manage(input: ModerationManageRequest): Effect.Effect<ModerationManageResult, ModerationStoreError>
    query(input: ModerationQueryRequest): Effect.Effect<ModerationQueryResult, ModerationStoreError>
    evaluate(input: ModerationEvaluateRequest): Effect.Effect<ModerationEvaluateResult, ModerationStoreError>
    join(input: ModerationJoinRequest): Effect.Effect<ModerationJoinResult, ModerationStoreError>
    dispatch(input: ModerationDispatchRequest): Effect.Effect<ModerationDispatchResult, ModerationStoreError>
    outcome(input: ModerationOutcomeRequest): Effect.Effect<ModerationOutcomeResult, ModerationStoreError>
    logOutcome(input: ModerationLogOutcomeRequest): Effect.Effect<ModerationLogOutcomeResult, ModerationStoreError>
    noticeOutcome(input: ModerationNoticeOutcomeRequest): Effect.Effect<ModerationNoticeOutcomeResult, ModerationStoreError>
    reconcile(input: ModerationReconcileRequest): Effect.Effect<ModerationReconcileResult, ModerationStoreError>
    observe(input: ModerationObserveRequest): Effect.Effect<ModerationObserveResult, ModerationStoreError>
    gate(input: ModerationGateRequest): Effect.Effect<ModerationGateResult, ModerationStoreError>
    memberAppeal(input: AppealMemberRequest): Effect.Effect<AppealMemberResult, ModerationStoreError>
    staffAppeal(input: AppealStaffRequest): Effect.Effect<AppealStaffResult, ModerationStoreError>
}

// A grant is accepted only together with its own case and the source that requested it
function boundGrant(result: { case?: ModerationCase, grant?: ModerationActionGrant, duplicate?: boolean }, sourceId?: string) {
    const value = result.grant
    if (!value) return true
    const record = result.case
    return !result.duplicate && !!record && record.actionId === value.actionId && record.caseNo === value.caseNo
        && record.sourceId === value.sourceId && (!sourceId || value.sourceId === sourceId)
        && record.action === value.action && record.targetId === value.targetId && record.channelId === value.channelId
}

function equalIds(actual: readonly string[], expected: readonly string[]) {
    return actual.length === expected.length && actual.every((value) => expected.includes(value))
}

export function createModerationStore(config: BackendConfig): ModerationStore {
    const post = createBackendRequest(config)
    function request<A>(path: string, body: unknown, schema: Schema.Codec<A>, matches: (result: A) => boolean = () => true) {
        return post(path, body).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.filterOrFail(matches, () => new ModerationStoreError({ operation: path, status: null })),
            Effect.mapError((error) => new ModerationStoreError({ operation: path, status: "status" in error && typeof error.status === "number" ? error.status : null, ...("code" in error && error.code ? { code: error.code } : {}) })),
        )
    }
    return {
        manage: (input) => request("/moderation/manage", input, ModerationManageResult, (result) => {
            if (result.duplicate) return true
            const op = input.operation
            // The grant must be the one this request created: same source, action, target, channel, messages and recovery
            if (op.type === "action") return result.type === "case" && boundGrant(result, input.messageId) && result.case.action === op.action.type
                && result.case.targetId === op.action.targetId && result.case.channelId === op.action.channelId
                && result.case.linkedCaseNo === op.action.linkedCaseNo
                && (!result.grant || (equalIds(result.grant.messageIds ?? [], op.action.messageIds ?? [])
                    && (!op.action.recoveryId || result.grant.recoveryId === op.action.recoveryId)))
            if (op.type === "settings") return result.type === "settings"
            if (op.type === "case-reason") return result.type === "case" && !result.grant && result.case.caseNo === op.caseNo
            if (op.type === "case-void") return result.type === "case" && result.case.action === "log" && result.case.linkedCaseNo === op.caseNo
                && result.case.caseNo !== op.caseNo && boundGrant(result, input.messageId)
            if (op.type === "rule-create" || op.type === "rule-update") {
                return result.type === "rule" && result.rule.name === (op.type === "rule-create" ? op.rule.name : op.name)
            }
            if (op.type === "rule-delete") return result.type === "deleted" && result.name === op.name
            if (op.type === "watchlist-add") return result.type === "watchlist" && result.entry.userId === op.userId
            if (op.type === "watchlist-remove") return result.type === "watchlist-removed" && result.userId === op.userId
            return result.type === "erased"
        }),
        query: (input) => request("/moderation/query", input, ModerationQueryResult, (result) => {
            const op = input.operation
            if (op.type === "case-show" || op.type === "recovery-case") return result.type === "case" && result.case.caseNo === op.caseNo
            if (op.type === "rule-show") return result.type === "rule" && result.rule.name === op.name
            if (op.type === "settings") return result.type === "settings"
            if (op.type === "watchlist-show") return result.type === "watchlist-entry" && result.entry.userId === op.userId
            if (op.type === "recovery-target") return result.type === "recovery" && result.recovery.targetId === op.targetId && result.recovery.type === "timeout"
            if (op.type === "recovery-channel") return result.type === "recovery" && result.recovery.channelId === op.channelId && result.recovery.type === "lock"
            if (op.type === "case-list") return result.type === "cases" && (!op.userId || result.cases.every((record) => record.targetId === op.userId))
            const types = { "rule-list": "rules", "watchlist-list": "watchlist", "recovery-list": "recoveries" }
            return result.type === types[op.type]
        }),
        // Automation may only act on the evaluated author and message, and never bans or kicks. A webhook or bot message may only be
        // logged or deleted, with no member target
        evaluate: (input) => request("/moderation/evaluate", input, ModerationEvaluateResult, (result) => boundGrant(result, input.messageId)
            && (!result.grant || ((input.author ? ["log", "delete"] : ["log", "warn", "delete", "timeout", "quarantine"]).includes(result.grant.action)
                && result.grant.targetId === (input.author ? undefined : input.userId) && (result.grant.channelId === undefined || result.grant.channelId === input.channelId)
                && (result.grant.action !== "delete" || equalIds(result.grant.messageIds ?? [], [input.messageId]))))),
        join: (input) => request("/moderation/join", input, ModerationJoinResult, (result) => boundGrant(result, `join:${input.userId}:${input.joinedAt}`)
            && (!result.grant || (["log", "quarantine"].includes(result.grant.action) && result.grant.targetId === input.userId && result.grant.channelId === undefined))),
        dispatch: (input) => request("/moderation/outcome", input, ModerationDispatchResult),
        outcome: (input) => request("/moderation/outcome", input, ModerationOutcomeResult, (result) =>
            (!result.log || (result.log.logId === input.actionId && result.log.caseNo === input.caseNo))
            && (!result.notice || (result.notice.noticeId === input.actionId && result.notice.caseNo === input.caseNo))),
        logOutcome: (input) => request("/moderation/log-outcome", input, ModerationLogOutcomeResult),
        noticeOutcome: (input) => request("/moderation/notice-outcome", input, ModerationNoticeOutcomeResult),
        reconcile: (input) => request("/moderation/reconcile", input, ModerationReconcileResult, (result) => result.case.actionId === input.actionId),
        observe: (input) => request("/moderation/observe", input, ModerationObserveResult),
        gate: (input) => request("/moderation/gate", input, ModerationGateResult),
        // Private appeal results must belong to the requester and the requested appeal or case
        memberAppeal: (input) => request("/appeals/member", input, AppealMemberResult, (result) => {
            const op = input.operation
            if (result.duplicate) return true
            if (result.type === "appeal") return result.appeal.userId === input.requesterId
                && (op.type === "submit" ? result.appeal.caseNo === op.caseNo : (op.type === "show" || op.type === "withdraw") && result.appeal.appealNo === op.appealNo)
            if (result.type === "cases") return op.type === "cases"
            return op.type === "list" && result.appeals.every((value) => value.userId === input.requesterId)
        }),
        staffAppeal: (input) => request("/appeals/staff", input, AppealStaffResult, (result) => {
            const op = input.operation
            if (result.duplicate) return true
            return result.type === "appeal" ? op.type !== "list" && result.appeal.appealNo === op.appealNo : op.type === "list"
        }),
    }
}

export function moderationErrorMessage(error: ModerationStoreError) {
    switch (error.status) {
        case 400: return "Some values in the command are not valid. Check them and try again"
        case 403: return "Your current permissions or DEFCON mode do not allow this operation"
        case 404: return "NeonFlux could not find that case, appeal, rule or entry. Check the number or name"
        case 409: return "That already exists or changed in the meantime. Look at it again before you retry"
        case 429: return "A limit was reached. Remove an entry you no longer need, or wait a minute and try again"
        default: return "NeonFlux couldn't confirm the operation. Check its status before attempting it again"
    }
}
