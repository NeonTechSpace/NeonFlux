import type * as C from "@neonflux/backend/contracts"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import type { OnboardingStore } from "./onboarding-store.ts"
import { performRoleGrant, roleMemberContext, withRoleMember } from "./roles.ts"
import { RolesStoreError, type RolesStore } from "./roles-store.ts"

/** The checklist is read again after ten minutes, or after a minute while it could not be read */
const VIEW_MS = 600000, RETRY_MS = 60000
/** Members seen finished in this process, so their later role changes cost nothing */
const FINISHED_LIMIT = 10000

export type OnboardingRuntime = ReturnType<typeof createOnboardingRuntime>
/** Each running server's onboarding runtime, so dashboard changes applied by the bot reach it */
export const onboardingRuntimes = new Map<string, OnboardingRuntime>()
/** What adding the completion role did. problem is a role store refusal with its code, such as BOT_PERMISSION */
export type CompletionRole = "added" | "uncertain" | "failed" | { problem: RolesStoreError }

/**
 * The newcomer checklist of one server. Members finish steps through rules verification, role panels and the role picker, so the bot watches
 * member role changes. It keeps the checklist and the roles that finish each step in memory and asks the backend only when a member holds a
 * role for every step, or when the member runs !onboarding. The backend records a completion once, and the completion role goes through the
 * shared role ownership, so an unconfirmed role change is never repeated
 */
export function createOnboardingRuntime(store: OnboardingStore, roles: RolesStore | undefined, serverId: string) {
    let view: C.OnboardingView | undefined, loadedAt = Number.NEGATIVE_INFINITY
    const finished = new Set<string>()
    const current = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (now - loadedAt >= (view ? VIEW_MS : RETRY_MS)) { loadedAt = now; view = yield* store.get({ serverId }) }
        return view
    })
    const remember = (userId: string) => {
        if (finished.size >= FINISHED_LIMIT) finished.delete(finished.values().next().value!)
        finished.add(userId)
    }
    // A changed checklist or completion role may concern members seen finished before
    const updated = (next: C.OnboardingView) => Effect.gen(function* () { view = next; loadedAt = yield* Clock.currentTimeMillis; finished.clear() })
    /** Reads the member fresh, records their progress and adds the completion role once */
    const check = (client: Client, userId: string) => withRoleMember(client, userId, Effect.gen(function* () {
        const fresh = yield* roleMemberContext(client, serverId, userId)
        const progress = yield* store.member({ serverId, context: fresh.context })
        if (progress.complete) remember(userId)
        if (!progress.grant || !roles) return { progress }
        const grant = progress.grant
        const role: CompletionRole = yield* Effect.gen(function* () {
            const result = yield* roles.evaluate({ serverId, sourceId: grant.sourceId, createdAt: yield* Clock.currentTimeMillis, context: fresh.context, operation: { type: "onboarding", roleId: grant.roleId } })
            if (!result.grant) return result.status === "blocked" ? "uncertain" as const : "added" as const
            const outcome = yield* performRoleGrant(roles, serverId, client, result.grant, userId, false, "Newcomer checklist finished")
            return outcome.outcome === "succeeded" ? "added" as const : outcome.outcome === "failed" ? "failed" as const : "uncertain" as const
        }).pipe(Effect.catchIf(error => error instanceof RolesStoreError && error.status === 403, error => Effect.succeed({ problem: error as RolesStoreError })))
        return { progress, role }
    }), serverId)
    return {
        current,
        updated,
        check,
        reload: () => Effect.suspend(() => { loadedAt = Number.NEGATIVE_INFINITY; finished.clear(); return current }).pipe(Effect.asVoid),
        /** A gateway member update. Only a member who may have just finished the last step causes a backend request */
        memberUpdated: (client: Client, member: { userId: string, roleIds: readonly string[], isBot: boolean }) => Effect.gen(function* () {
            if (member.isBot || finished.has(member.userId)) return
            const checklist = yield* current
            if (!checklist?.settings.enabled || !checklist.roleSteps.length || !checklist.roleSteps.every(ids => ids.some(id => member.roleIds.includes(id)))) return
            yield* check(client, member.userId)
        }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Newcomer checklist progress could not be checked. The member can run !onboarding"))),
    }
}
/** Registers a server's runtime while its scope is open. The checklist is read on first use */
export function registerOnboardingRuntime(serverId: string, runtime: OnboardingRuntime) {
    return Effect.gen(function* () {
        onboardingRuntimes.set(serverId, runtime)
        yield* Effect.addFinalizer(() => Effect.sync(() => { if (onboardingRuntimes.get(serverId) === runtime) onboardingRuntimes.delete(serverId) }))
    })
}
