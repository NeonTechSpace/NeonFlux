import type { LevelingProfile, LevelingSettings } from "@neonflux/contracts/leveling"
import { Effect } from "effect"
import { LevelingStoreError, type LevelingStore } from "../src/level-store.ts"

export const levelSettings = (): LevelingSettings => ({ enabled: false, xpPerMessage: 15, cooldownSeconds: 60, excludedChannelIds: [], excludedRoleIds: [],
    revision: 1, mappingRevision: 1, scoreEpoch: 1, mappings: [] })
export function levelProfile(userId: string, xp = 0): LevelingProfile {
    const level = Math.floor(Math.sqrt(xp / 100))
    return { userId, xp, level, nextLevelXp: level === 1000 ? null : 100 * (level + 1) ** 2, fence: { scoreEpoch: 1, adjustmentRevision: 0, mappingRevision: 1 } }
}
export function levelsBoundary(overrides: Partial<LevelingStore> = {}) {
    const calls: { method: string, input: unknown }[] = [], settings = levelSettings()
    const record = (method: string, input: unknown) => { calls.push({ method, input: structuredClone(input) }) }
    const base: LevelingStore = {
        manage: () => Effect.fail(new LevelingStoreError({ operation: "manage", status: 403 })),
        query: input => {
            const op = input.operation
            if (op.type === "settings") return Effect.succeed({ type: "settings", settings })
            if (op.type === "rank") return Effect.succeed({ type: "rank", profile: levelProfile(op.userId ?? input.actor.userId), rank: { type: "unranked" } })
            if (op.type === "leaderboard") return Effect.succeed({ type: "leaderboard", profiles: [] })
            if (op.type === "status") return Effect.succeed({ type: "status", dirty: 0, sweepPending: false, profiles: 0 })
            return Effect.succeed({ type: "audits", audits: [] })
        },
        preflight: () => Effect.succeed({ eligible: false, reason: "disabled" }),
        award: () => Effect.succeed({ awarded: false, reason: "disabled" }),
        work: input => input.operation.type === "list" ? Effect.succeed({ type: "accounts", accounts: [], sweepPending: false })
            : Effect.fail(new LevelingStoreError({ operation: "work", status: 404 })),
        ...overrides,
    }
    const store: LevelingStore = {
        manage: input => Effect.suspend(() => { record("manage", input); return base.manage(input) }),
        query: input => Effect.suspend(() => { record("query", input); return base.query(input) }),
        preflight: input => Effect.suspend(() => { record("preflight", input); return base.preflight(input) }),
        award: input => Effect.suspend(() => { record("award", input); return base.award(input) }),
        work: input => Effect.suspend(() => { record("work", input); return base.work(input) }),
    }
    return { store, calls, settings }
}
