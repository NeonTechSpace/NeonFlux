import type { RolesAcknowledgment, RolesAttempt, RolesEvaluateRequest, RolesEvaluateResult, RolesGrant, RolesPanel, RolesSettings } from "@neonflux/contracts/roles"
import { Effect, type Types } from "effect"
import { RolesStoreError, type RolesStore } from "../src/roles-store.ts"
import type { PublishingStore } from "../src/publishing-store.ts"
import { isDeepStrictEqual } from "node:util"

export function rolesBoundary(publishing?: PublishingStore, overrides: Partial<RolesStore> = {}) {
    const current: Types.Mutable<RolesSettings> = { panelsEnabled: false, verificationEnabled: false, autoroleEnabled: false, humansOnly: true, autoroleIds: [], revision: 1 }
    const panels = new Map<string, Types.Mutable<RolesPanel>>(), attempts = new Map<string, Types.Mutable<RolesAttempt>>()
    const calls: { method: string, input: unknown }[] = []
    const acknowledgment: Types.Mutable<RolesAcknowledgment> = { acknowledged: false, accessConfirmed: false, accessRolePresent: false }
    let counter = 0
    const record = (method: string, input: unknown) => calls.push({ method, input })
    const missing = (operation: string) => Effect.fail(new RolesStoreError({ operation, status: 404 }))
    const reserve = (input: RolesEvaluateRequest, roleId: string, selected: boolean, consumerKey: string): RolesEvaluateResult => {
        if (input.context.roleIds.includes(roleId) === selected) return { duplicate: false, status: "unchanged", acknowledgment: { ...acknowledgment } }
        const grant: RolesGrant = { attemptId: `synthetic_role_${++counter}`, ownershipId: `synthetic_owner_${roleId}`, generation: counter,
            sourceId: input.sourceId, action: selected ? "add" : "remove", userId: input.context.userId, joinedAt: input.context.joinedAt, roleId,
            botId: input.context.botId, expectedPresent: !selected, consumerKey, dispatchExpiresAt: Number.MAX_SAFE_INTEGER, nativeDeadlineMs: 5000 }
        attempts.set(grant.attemptId, { ...grant, outcome: "pending", createdAt: input.createdAt })
        return { duplicate: false, status: "reserved", acknowledgment: { ...acknowledgment }, grant }
    }
    const store: RolesStore = {
        reactionJobs: (input) => { record("reactionJobs", input); return input.operation.type === "list" ? Effect.succeed({ type: "jobs", jobs: [] }) : missing("reaction-jobs") },
        policy: (input) => { record("policy", input); return Effect.succeed({ settings: { ...current } }) },
        observe: (input) => { record("observe", input); return Effect.succeed({ uncertainAttempts: 0 }) },
        query: (input) => {
            record("query", input); const op = input.operation
            if (op.type === "settings") return Effect.succeed({ type: "settings", settings: { ...current } })
            if (op.type === "panel-show") { const panel = panels.get(op.name); return panel ? Effect.succeed({ type: "panel", panel: structuredClone(panel) }) : missing("query") }
            if (op.type === "panel-list") return Effect.succeed({ type: "panels", panels: [...panels.values()], page: op.page ?? 1, totalPages: 1 })
            if (op.type === "attempt-show") { const attempt = attempts.get(op.attemptId); return attempt ? Effect.succeed({ type: "attempt", attempt }) : missing("query") }
            if (op.type === "claim-list") return Effect.succeed({ type: "claims", claims: [] })
            return missing("query")
        },
        manage: (input) => Effect.gen(function* () {
            record("manage", input); const op = input.operation
            if (op.type === "settings") { Object.assign(current, op.patch); current.revision++; return { duplicate: false, type: "settings", settings: { ...current } } as const }
            if (op.type === "panel-create") {
                const panel: RolesPanel = { name: op.name, kind: op.kind, revision: 1, enabled: true, exclusive: op.exclusive ?? false, mappings: op.mappings ?? [], withdrawing: false }
                panels.set(panel.name, panel); return { duplicate: false, type: "panel", panel: structuredClone(panel) } as const
            }
            if (op.type === "panel-update") {
                const panel = panels.get(op.name); if (!panel) return yield* missing("manage")
                Object.assign(panel, op.patch)
                if (op.patch.mappings !== undefined || op.patch.exclusive !== undefined) panel.revision++
                return { duplicate: false, type: "panel", panel: structuredClone(panel) } as const
            }
            if (op.type === "panel-bind" && publishing) {
                const panel = panels.get(op.name), found = yield* publishing.query({ serverId: input.serverId, actor: input.actor, operation: { type: "post-show", postNo: op.postNo } }).pipe(Effect.mapError(() => new RolesStoreError({ operation: "manage", status: null })))
                if (!panel || found.type !== "post" || !found.post.messageId || !found.post.confirmedCanonicalContent) return yield* missing("manage")
                panel.published = { revision: panel.revision, publishedAt: input.createdAt, postNo: op.postNo, postGeneration: op.expectedPostGeneration, channelId: found.post.channelId,
                    messageId: found.post.messageId, botId: found.post.botId, content: found.post.confirmedCanonicalContent, mappings: structuredClone(panel.mappings), exclusive: panel.exclusive }
                return { duplicate: false, type: "panel", panel: structuredClone(panel) } as const
            }
            return yield* missing("manage")
        }),
        memberQuery: (input) => { record("memberQuery", input); return Effect.succeed({ settings: { ...current }, panels: structuredClone([...panels.values()]), acknowledgment: { ...acknowledgment } }) },
        evaluate: (input) => {
            record("evaluate", input); const op = input.operation
            if (op.type === "join") {
                const roleId = [...new Set([...current.autoroleIds, ...(current.reservations ?? []).filter(row => row.userId === input.context.userId).flatMap(row => row.roleIds)])].find((id) => !input.context.roleIds.includes(id))
                return Effect.succeed(roleId ? reserve(input, roleId, true, `autorole:${current.revision}`) : { duplicate: false, status: "unchanged", acknowledgment })
            }
            if (op.type === "withdraw-member") return Effect.succeed(reserve(input, op.roleId, false, op.consumerKey))
            if (op.type === "withdraw") return Effect.succeed(reserve(input, op.roleId, false, "panel:colors:1"))
            if (op.type === "onboarding") return Effect.succeed(input.context.roleIds.includes(op.roleId) ? { duplicate: false, status: "unchanged", acknowledgment } : reserve(input, op.roleId, true, "onboarding"))
            if (op.type === "level-sync" || op.type === "temporary") return Effect.succeed({ duplicate: false, status: "unchanged", acknowledgment })
            if (op.type === "pick") return Effect.succeed(reserve(input, op.roleId, op.selected, `picker:${op.menu}`))
            const panel = panels.get(op.name)
            if (!panel) return missing("evaluate")
            if (op.type === "verify") {
                if (op.reactionPresent === false) return Effect.succeed({ duplicate: false, status: "unchanged", acknowledgment })
                acknowledgment.acknowledged = true; acknowledgment.rulesRevision = panel.revision; acknowledgment.acknowledgedAt = input.createdAt
                return Effect.succeed(reserve(input, panel.mappings[0]!.roleId, true, `panel:${panel.name}:${panel.revision}`))
            }
            const mapping = op.type === "choose" ? panel.mappings.find((m) => m.roleId === op.roleId) : panel.mappings.find((m) => op.presentEmojis.includes(m.emoji)) ?? panel.mappings[0]
            if (!mapping) return Effect.succeed({ duplicate: false, status: "unchanged", acknowledgment })
            return Effect.succeed(reserve(input, mapping.roleId, op.type === "choose" ? op.selected : op.presentEmojis.includes(mapping.emoji), `panel:${panel.name}:${panel.revision}`))
        },
        dispatch: (input) => { record("dispatch", input); const attempt = attempts.get(input.attemptId); return attempt ? Effect.succeed({ claimed: attempt.outcome === "pending", dispatchExpiresAt: attempt.dispatchExpiresAt, nativeDeadlineMs: 5000 }) : missing("dispatch") },
        outcome: (input) => { record("outcome", input); const attempt = attempts.get(input.attemptId); if (attempt) attempt.outcome = input.outcome; return Effect.succeed({ recorded: true }) },
        reconcile: (input) => { record("reconcile", input); return missing("reconcile") },
        ...overrides,
    }
    return { store, calls, current, panels, attempts }
}
