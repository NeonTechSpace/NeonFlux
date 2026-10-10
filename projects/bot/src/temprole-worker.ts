import type * as C from "@neonflux/backend/contracts"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Exit, Queue } from "effect"
import { readNativeMember } from "./member-evidence.ts"
import { performRoleGrant, roleMemberContext, withRoleMember } from "./roles.ts"
import { RolesStoreError, type RolesStore } from "./roles-store.ts"
import type { TemporaryRoleStore } from "./temprole-store.ts"

/**
 * What settling a grant did. added and removed are role changes NeonFlux made. unchanged means the role was already where the grant wants it,
 * or after the end time that NeonFlux did not add it or another feature still needs it. ended closes a grant whose member left or whose role was deleted
 */
export type TemporaryRoleSettlement = { readonly state: "added" | "removed" | "unchanged" | "ended" } | { readonly state: "problem", readonly problem: C.TemporaryRoleProblem }
/** Due grants are listed this many at a time, and one pass reads at most this many pages */
const PAGES_PER_PASS = 10

/**
 * Brings one grant's role in line with it through the shared role ownership: Before the end time the member holds the role, and after it
 * NeonFlux removes the role it added. Every change reads the member and roles fresh, and an unconfirmed change is never repeated. A grant
 * NeonFlux cannot settle stays with its problem and is checked again later. actorId is the staff member of a command, whose rank is checked too
 */
export function settleTemporaryRole(store: TemporaryRoleStore, roles: RolesStore, serverId: string, client: Client, grant: C.TemporaryRoleGrant, actorId = grant.userId) {
    const binding = { userId: grant.userId, roleId: grant.roleId, sourceId: grant.sourceId }
    const problem = (value: C.TemporaryRoleProblem) => store.work({ serverId, operation: { type: "problem", ...binding, problem: value } }).pipe(
        Effect.catch(() => Effect.void), Effect.as<TemporaryRoleSettlement>({ state: "problem", problem: value }))
    const settle = Effect.gen(function* () {
        const evidence = yield* readNativeMember(client, serverId, grant.userId, { allowAbsent: true })
        const native = evidence.member
        // Leaving takes the role along, and a later membership does not inherit the grant
        if (!native || native.joinedAt !== grant.joinedAt) {
            yield* store.work({ serverId, operation: { type: "end", ...binding, reason: "member", originServerId: evidence.originServerId, memberUserId: evidence.userId,
                observedAt: yield* Clock.currentTimeMillis, currentJoinedAt: native?.joinedAt ?? null, ...(!native ? { memberAbsent: true as const } : {}) } })
            return { state: "ended" } as TemporaryRoleSettlement
        }
        let removed = false
        // A confirmed removal is evaluated once more, which closes the grant
        for (let step = 0; step < 2; step++) {
            const fresh = yield* roleMemberContext(client, serverId, grant.userId, actorId)
            if (!fresh.context.roles.some(role => role.roleId === grant.roleId)) {
                yield* store.work({ serverId, operation: { type: "end", ...binding, reason: "role" } })
                return { state: "ended" } as TemporaryRoleSettlement
            }
            const result = yield* roles.evaluate({ serverId, sourceId: grant.sourceId, createdAt: yield* Clock.currentTimeMillis, context: fresh.context,
                operation: { type: "temporary", roleId: grant.roleId } }).pipe(Effect.catch(error => error instanceof RolesStoreError && (error.code === "BOT_PERMISSION" || error.code === "ROLE_NOT_ELIGIBLE")
                    ? Effect.succeed(error.code === "BOT_PERMISSION" ? "permission" as const : "role" as const) : Effect.fail(error)))
            if (result === "permission" || result === "role") return yield* problem(result)
            if (result.status === "blocked") return yield* problem("uncertain")
            if (!result.grant) return { state: removed ? "removed" : "unchanged" } as TemporaryRoleSettlement
            const action = result.grant.action
            const outcome = yield* performRoleGrant(roles, serverId, client, result.grant, actorId, false, action === "add" ? "Temporary role" : "Temporary role ended")
            if (outcome.outcome === "failed") return yield* problem("refused")
            if (outcome.outcome !== "succeeded" || !outcome.acknowledged) return yield* problem("uncertain")
            if (action === "add") return { state: "added" } as TemporaryRoleSettlement
            removed = true
        }
        return { state: "removed" } as TemporaryRoleSettlement
    })
    return withRoleMember(client, grant.userId, settle, serverId).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : problem("unavailable")))
}

export function startTemporaryRoleWorker(store: TemporaryRoleStore, roles: RolesStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<true>({ capacity: 1, strategy: "dropping" })
        yield* Effect.addFinalizer(() => Queue.shutdown(queue))
        // Every listed grant leaves the due list, by settling, ending or a problem with a later check, so the next page holds other grants
        const pass = Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const due = yield* store.work({ serverId, operation: { type: "list" } })
                if (due.type !== "grants" || !due.grants.length) return
                for (const grant of due.grants) yield* settleTemporaryRole(store, roles, serverId, client, grant)
                if (due.grants.length < 10) return
            }
        })
        yield* Effect.gen(function* () {
            for (;;) {
                yield* Queue.take(queue)
                const done = yield* Effect.exit(pass)
                if (Exit.isFailure(done) && Cause.hasInterrupts(done.cause)) return yield* Effect.failCause(done.cause)
                if (Exit.isFailure(done)) yield* Effect.logWarning("Temporary roles could not be read. Due grants stay listed for the next check")
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
        // The work dispatcher wakes this worker once grants are due
        return { notify: () => Queue.offer(queue, true).pipe(Effect.asVoid) }
    })
}
