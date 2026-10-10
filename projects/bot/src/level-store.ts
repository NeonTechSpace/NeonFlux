import { LevelingAwardResult, LevelingManageResult, LevelingPreflightResult, LevelingQueryResult, LevelingWorkResult, type LevelingAwardRequest, type LevelingFence, type LevelingManageRequest,
    type LevelingPreflightRequest, type LevelingProfile, type LevelingQueryRequest, type LevelingSettings, type LevelingWorkRequest } from "@neonflux/contracts/leveling"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class LevelingStoreError extends Data.TaggedError("LevelingStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface LevelingStore {
    manage(input: LevelingManageRequest): Effect.Effect<LevelingManageResult, LevelingStoreError>
    query(input: LevelingQueryRequest): Effect.Effect<LevelingQueryResult, LevelingStoreError>
    preflight(input: LevelingPreflightRequest): Effect.Effect<LevelingPreflightResult, LevelingStoreError>
    award(input: LevelingAwardRequest): Effect.Effect<LevelingAwardResult, LevelingStoreError>
    work(input: LevelingWorkRequest): Effect.Effect<LevelingWorkResult, LevelingStoreError>
}
const matchesFence = (a: LevelingFence, b: LevelingFence) => a.scoreEpoch === b.scoreEpoch && a.adjustmentRevision === b.adjustmentRevision && a.mappingRevision === b.mappingRevision
export function createLevelingStore(config: BackendConfig): LevelingStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/levels/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new LevelingStoreError({ operation, status: null })),
        Effect.mapError(error => new LevelingStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, LevelingManageResult, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "settings") return v.type === "settings" && v.settings.revision > op.expectedRevision
                && Object.entries(op.patch).every(([k, value]) => JSON.stringify(value) === JSON.stringify(v.settings[k as keyof LevelingSettings]))
            if (op.type === "mappings") return v.type === "settings" && v.settings.mappingRevision > op.expectedMappingRevision
                && v.settings.mappings.length === op.mappings.length && op.mappings.every(m => v.settings.mappings.some(n => m.level === n.level && m.roleId === n.roleId))
            if (op.type === "reconcile") return v.type === "reconcile"
            const audited = v.type !== "reconcile" && v.type !== "settings" && v.audit.type === op.type
                && v.audit.actorId === input.actor.userId && v.audit.reason === op.reason
            if (op.type === "reset-server") return v.type === "reset" && audited && v.audit.scoreEpoch === v.settings.scoreEpoch
            return v.type === "profile" && audited && v.profile.userId === op.userId && v.profile.xp === (op.type === "adjust" ? op.xp : 0)
                && v.audit.userId === op.userId && v.audit.afterXp === v.profile.xp && v.audit.scoreEpoch === v.profile.fence.scoreEpoch
        }),
        query: input => call("query", input, LevelingQueryResult, v => {
            const op = input.operation
            if (v.type !== op.type) return false
            if (v.type === "rank" && op.type === "rank") return v.profile.userId === (op.userId ?? input.actor.userId)
                && (v.rank.type === "unranked" ? v.profile.xp === 0 : v.profile.xp > 0) && (v.rank.type !== "range" || v.rank.from <= v.rank.to)
            if (v.type === "audits" && op.type === "audits") return v.audits.every((a, i) => (op.beforeAuditNo === undefined || a.auditNo < op.beforeAuditNo)
                && (i === 0 || a.auditNo < v.audits[i - 1]!.auditNo))
                && (v.nextBeforeAuditNo === undefined || v.audits.length > 0 && v.nextBeforeAuditNo === v.audits.at(-1)!.auditNo)
            if (v.type === "leaderboard" && op.type === "leaderboard") {
                const after = (p: LevelingProfile, c: { xp: number, userId: string }) => p.xp < c.xp || p.xp === c.xp && p.userId < c.userId
                const last = v.profiles.at(-1)
                return new Set(v.profiles.map(p => p.userId)).size === v.profiles.length
                    && v.profiles.every((p, i) => p.xp > 0 && (!op.cursor || p.fence.scoreEpoch === op.cursor.scoreEpoch && after(p, op.cursor))
                        && (i === 0 || p.fence.scoreEpoch === v.profiles[0]!.fence.scoreEpoch && after(p, v.profiles[i - 1]!)))
                    && (!v.nextCursor || (v.nextCursor.originServerId === undefined || v.nextCursor.originServerId === input.serverId) && v.profiles.length === 10 && !!last && v.nextCursor.xp === last.xp && v.nextCursor.userId === last.userId && v.nextCursor.scoreEpoch === last.fence.scoreEpoch)
            }
            return true
        }),
        preflight: input => call("preflight", input, LevelingPreflightResult),
        award: input => call("award", input, LevelingAwardResult, v => !v.awarded || v.profile.userId === input.candidate.userId && matchesFence(v.profile.fence, input.fence) && v.profile.xp >= v.xpAdded),
        work: input => call("work", input, LevelingWorkResult, v => {
            if (input.operation.type !== "list") return v.type === "progress"
            return v.type === "accounts" && new Set(v.accounts.map(a => a.userId)).size === v.accounts.length
                && v.accounts.every(a => new Set(a.targets.map(t => t.roleId)).size === a.targets.length && new Set(a.targets.map(t => t.sourceId)).size === a.targets.length)
        }),
    }
}

export function levelingErrorMessage(error: LevelingStoreError) {
    if (error.status === 403) return "You can't do that with leveling here. Check that leveling is on and you have the needed permission"
    if (error.status === 409) return "Leveling changed while this command ran. Send the command again"
    if (error.status === 404) return "That leveling entry was not found"
    if (error.status === 400) return "That leveling change is not valid. Use !level help to check the limits and the confirm step"
    return "The leveling change could not be confirmed. Check the current levels before you repeat it"
}
