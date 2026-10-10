import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(n => Number.isSafeInteger(n) && n >= min && n <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.makeFilter(v => v.length > 0 && v.length <= 256))
const epoch = Schema.String.check(Schema.makeFilter(v => v.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))))
const optional = Schema.optionalKey
const list = <A>(schema: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(max))
const ids = (max: number) => list(id, max).check(Schema.makeFilter(v => new Set(v).size === v.length))
const fence = Schema.Struct({ scoreEpoch: integer(1), adjustmentRevision: integer(), mappingRevision: integer(1) })
const mapping = Schema.Struct({ level: integer(1, 1000), roleId: id })
const settings = Schema.Struct({ enabled: Schema.Boolean, xpPerMessage: integer(1, 100), cooldownSeconds: integer(15, 3600),
    excludedChannelIds: ids(50), excludedRoleIds: ids(50), revision: integer(1), mappingRevision: integer(1), scoreEpoch: integer(1),
    mappings: list(mapping, 20).check(Schema.makeFilter(v => new Set(v.map(m => m.level)).size === v.length && new Set(v.map(m => m.roleId)).size === v.length)) })
const profile = Schema.Struct({ userId: id, xp: integer(0, 100000000), level: integer(0, 1000), nextLevelXp: Schema.NullOr(integer(100, 100000000)), fence })
    .check(Schema.makeFilter(v => v.level === Math.floor(Math.sqrt(v.xp / 100)) && v.nextLevelXp === (v.level === 1000 ? null : 100 * (v.level + 1) ** 2)))
const audit = Schema.Struct({ auditNo: integer(1), actorId: id, userId: optional(id), beforeXp: optional(integer(0, 100000000)), afterXp: optional(integer(0, 100000000)),
    reason: Schema.String.check(Schema.makeFilter(v => v.length > 0 && v.length <= 500)), createdAt: integer(), type: Schema.Literals(["adjust", "reset-member", "reset-server"]), scoreEpoch: integer(1) })
    .check(Schema.makeFilter(v => v.type === "reset-server" ? v.userId === undefined && v.beforeXp === undefined && v.afterXp === undefined
        : v.userId !== undefined && v.beforeXp !== undefined && v.afterXp !== undefined && (v.type !== "reset-member" || v.afterXp === 0)))
const leaderboardCursor = Schema.Struct({ xp: integer(0, 100000000), userId: id, scoreEpoch: integer(1), originServerId: optional(id) })
const manage = Schema.Union([
    Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("profile"), profile, audit }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reset"), settings, audit }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconcile"), queued: Schema.Boolean }),
])
const query = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings }),
    Schema.Struct({ type: Schema.Literal("rank"), profile, rank: Schema.Union([
        Schema.Struct({ type: Schema.Literal("exact"), position: integer(1, 50000) }),
        Schema.Struct({ type: Schema.Literal("range"), from: integer(2, 50000), to: integer(2, 50000) }),
        Schema.Struct({ type: Schema.Literal("outside-top-1000") }), Schema.Struct({ type: Schema.Literal("unranked") }),
    ]) }),
    Schema.Struct({ type: Schema.Literal("leaderboard"), profiles: list(profile, 20), nextCursor: optional(leaderboardCursor) }),
    Schema.Struct({ type: Schema.Literal("status"), dirty: integer(), sweepPending: Schema.Boolean, profiles: integer(0, 50000) }),
    Schema.Struct({ type: Schema.Literal("audits"), audits: list(audit, 20), nextBeforeAuditNo: optional(integer(1)) }),
])
const reject = Schema.Literals(["disabled", "stale", "excluded", "cooldown", "duplicate", "capacity", "policy", "membership", "fence"])
const preflight = Schema.Union([Schema.Struct({ eligible: Schema.Literal(false), reason: reject }), Schema.Struct({ eligible: Schema.Literal(true), policyRevision: integer(1), fence })])
const award = Schema.Union([Schema.Struct({ awarded: Schema.Literal(false), reason: reject }),
    Schema.Struct({ awarded: Schema.Literal(true), xpAdded: integer(0, 100), profile, rewardQueued: Schema.Boolean })])
const rewardAccount = Schema.Struct({ userId: id, mark: integer(1), refs: list(Schema.Struct({ roleId: id, joinedAt: epoch }), 40),
    targets: list(Schema.Struct({ roleId: id, sourceId: key }), 60), complete: Schema.Boolean })
const work = Schema.Union([
    Schema.Struct({ type: Schema.Literal("accounts"), accounts: list(rewardAccount, 10), sweepPending: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean }),
])

export class LevelingStoreError extends Data.TaggedError("LevelingStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface LevelingStore {
    manage(input: C.LevelingManageRequest): Effect.Effect<C.LevelingManageResult, LevelingStoreError>
    query(input: C.LevelingQueryRequest): Effect.Effect<C.LevelingQueryResult, LevelingStoreError>
    preflight(input: C.LevelingPreflightRequest): Effect.Effect<C.LevelingPreflightResult, LevelingStoreError>
    award(input: C.LevelingAwardRequest): Effect.Effect<C.LevelingAwardResult, LevelingStoreError>
    work(input: C.LevelingWorkRequest): Effect.Effect<C.LevelingWorkResult, LevelingStoreError>
}
const matchesFence = (a: C.LevelingFence, b: C.LevelingFence) => a.scoreEpoch === b.scoreEpoch && a.adjustmentRevision === b.adjustmentRevision && a.mappingRevision === b.mappingRevision
export function createLevelingStore(config: BackendConfig): LevelingStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/levels/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new LevelingStoreError({ operation, status: null })),
        Effect.mapError(error => new LevelingStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, manage, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "settings") return v.type === "settings" && v.settings.revision > op.expectedRevision
                && Object.entries(op.patch).every(([k, value]) => JSON.stringify(value) === JSON.stringify(v.settings[k as keyof C.LevelingSettings]))
            if (op.type === "mappings") return v.type === "settings" && v.settings.mappingRevision > op.expectedMappingRevision
                && v.settings.mappings.length === op.mappings.length && op.mappings.every(m => v.settings.mappings.some(n => m.level === n.level && m.roleId === n.roleId))
            if (op.type === "reconcile") return v.type === "reconcile"
            const audited = v.type !== "reconcile" && v.type !== "settings" && v.audit.type === op.type
                && v.audit.actorId === input.actor.userId && v.audit.reason === op.reason
            if (op.type === "reset-server") return v.type === "reset" && audited && v.audit.scoreEpoch === v.settings.scoreEpoch
            return v.type === "profile" && audited && v.profile.userId === op.userId && v.profile.xp === (op.type === "adjust" ? op.xp : 0)
                && v.audit.userId === op.userId && v.audit.afterXp === v.profile.xp && v.audit.scoreEpoch === v.profile.fence.scoreEpoch
        }),
        query: input => call("query", input, query, v => {
            const op = input.operation
            if (v.type !== op.type) return false
            if (v.type === "rank" && op.type === "rank") return v.profile.userId === (op.userId ?? input.actor.userId)
                && (v.rank.type === "unranked" ? v.profile.xp === 0 : v.profile.xp > 0) && (v.rank.type !== "range" || v.rank.from <= v.rank.to)
            if (v.type === "audits" && op.type === "audits") return v.audits.every((a, i) => (op.beforeAuditNo === undefined || a.auditNo < op.beforeAuditNo)
                && (i === 0 || a.auditNo < v.audits[i - 1]!.auditNo))
                && (v.nextBeforeAuditNo === undefined || v.audits.length > 0 && v.nextBeforeAuditNo === v.audits.at(-1)!.auditNo)
            if (v.type === "leaderboard" && op.type === "leaderboard") {
                const after = (p: C.LevelingProfile, c: { xp: number, userId: string }) => p.xp < c.xp || p.xp === c.xp && p.userId < c.userId
                const last = v.profiles.at(-1)
                return new Set(v.profiles.map(p => p.userId)).size === v.profiles.length
                    && v.profiles.every((p, i) => p.xp > 0 && (!op.cursor || p.fence.scoreEpoch === op.cursor.scoreEpoch && after(p, op.cursor))
                        && (i === 0 || p.fence.scoreEpoch === v.profiles[0]!.fence.scoreEpoch && after(p, v.profiles[i - 1]!)))
                    && (!v.nextCursor || (v.nextCursor.originServerId === undefined || v.nextCursor.originServerId === input.serverId) && v.profiles.length === 20 && !!last && v.nextCursor.xp === last.xp && v.nextCursor.userId === last.userId && v.nextCursor.scoreEpoch === last.fence.scoreEpoch)
            }
            return true
        }),
        preflight: input => call("preflight", input, preflight),
        award: input => call("award", input, award, v => !v.awarded || v.profile.userId === input.candidate.userId && matchesFence(v.profile.fence, input.fence) && v.profile.xp >= v.xpAdded),
        work: input => call("work", input, work, v => {
            if (input.operation.type !== "list") return v.type === "progress"
            return v.type === "accounts" && new Set(v.accounts.map(a => a.userId)).size === v.accounts.length
                && v.accounts.every(a => new Set(a.targets.map(t => t.roleId)).size === a.targets.length && new Set(a.targets.map(t => t.sourceId)).size === a.targets.length)
        }),
    }
}

export function levelingErrorMessage(error: LevelingStoreError) {
    if (error.status === 403) return "Current leveling permission or policy rejected this request"
    if (error.status === 409) return "Leveling state changed while this command ran. Repeat the command to apply it to the current state"
    if (error.status === 404) return "That leveling record is unavailable. Read current status before trying again"
    if (error.status === 400) return "The leveling request was rejected. Use !level help to check bounds and confirmation"
    return "Leveling persistence could not be confirmed. Inspect current state before repeating a change"
}
