import {
    TEMPORARY_ROLE_RETRY_MS,
    type TemporaryRoleGrant,
    type TemporaryRoleProblem,
} from "@neonflux/contracts/temporary-roles"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import { readNativeMember } from "./member-evidence.ts"
import { performRoleGrant, roleMemberContext, withRoleMember } from "./roles.ts"
import { RolesStoreError, type RolesStore } from "./roles-store.ts"
import type { TemporaryRoleStore } from "./temprole-store.ts"
import { startSignalledWorker } from "./signalled-worker.ts"

/**
 * What settling a grant did. added and removed are role changes NeonFlux made. unchanged means the role was already where the grant wants it,
 * or after the end time that NeonFlux did not add it or another feature still needs it. ended closes a grant whose member is gone at its end
 * time or whose role was deleted. away keeps the grant of a member who left, for a rejoin before the end time
 */
export type TemporaryRoleSettlement =
    | { readonly state: "added" | "removed" | "unchanged" | "ended" | "away" }
    | { readonly state: "problem"; readonly problem: TemporaryRoleProblem }
/** The role refusals that leave a grant with a problem. A member who cannot receive the role yet waits and is checked again */
const refusals = {
    BOT_PERMISSION: "permission",
    ROLE_NOT_ELIGIBLE: "role",
    MEMBER_NOT_READY: "waiting",
} as const satisfies Record<string, TemporaryRoleProblem>
/** Due grants are listed this many at a time, and one pass reads at most this many pages */
const PAGES_PER_PASS = 10

/**
 * Brings one grant's role in line with it through the shared role ownership: Before the end time the member holds the role, and after it
 * NeonFlux removes the role it added. Every change reads the member and roles fresh, and an unconfirmed change is never repeated. A grant
 * NeonFlux cannot settle stays with its problem and is checked again later. actorId is the staff member of a command, whose rank is checked too
 */
export function settleTemporaryRole(
    store: TemporaryRoleStore,
    roles: RolesStore,
    serverId: string,
    client: Client,
    grant: TemporaryRoleGrant,
    actorId = grant.userId,
) {
    const problem = (current: TemporaryRoleGrant, value: TemporaryRoleProblem, retryAfterMs?: number) =>
        store
            .work({
                serverId,
                operation: {
                    type: "problem",
                    userId: current.userId,
                    roleId: current.roleId,
                    sourceId: current.sourceId,
                    problem: value,
                    ...(retryAfterMs !== undefined
                        ? { retryAfterMs: Math.min(Math.max(1, retryAfterMs), TEMPORARY_ROLE_RETRY_MS) }
                        : {}),
                },
            })
            .pipe(
                Effect.catch(() => Effect.void),
                Effect.as<TemporaryRoleSettlement>({ state: "problem", problem: value }),
            )
    // The member lock is not re-entrant, so a grant that moved to a rejoined membership is settled once more inside the same hold
    const settle = (current: TemporaryRoleGrant, moved: boolean): Effect.Effect<TemporaryRoleSettlement, unknown> =>
        Effect.gen(function* () {
            const binding = { userId: current.userId, roleId: current.roleId, sourceId: current.sourceId }
            const evidence = yield* readNativeMember(client, serverId, current.userId)
            const native = evidence.member,
                now = yield* Clock.currentTimeMillis
            // A member who rejoined gets a running grant moved to the new membership, with fresh checks. The backend deletes one
            // that ended
            if (native && !moved && Date.parse(native.joinedAt) > Date.parse(current.joinedAt)) {
                const rejoined = yield* store.work({
                    serverId,
                    operation: {
                        type: "rejoin",
                        userId: current.userId,
                        joinedAt: native.joinedAt,
                        originServerId: evidence.originServerId,
                        memberUserId: evidence.userId,
                        observedAt: now,
                    },
                })
                const next =
                    rejoined.type === "grants" ? rejoined.grants.find((x) => x.roleId === current.roleId) : undefined
                return next ? yield* settle(next, true) : ({ state: "ended" } as TemporaryRoleSettlement)
            }
            // Leaving takes the role along. The grant waits for a rejoin until its end time
            if (!native || native.joinedAt !== current.joinedAt) {
                const ended = yield* store.work({
                    serverId,
                    operation: {
                        type: "end",
                        ...binding,
                        reason: "member",
                        originServerId: evidence.originServerId,
                        memberUserId: evidence.userId,
                        observedAt: now,
                        currentJoinedAt: native?.joinedAt ?? null,
                        ...(!native ? { memberAbsent: true as const } : {}),
                    },
                })
                return { state: ended.type === "recorded" && ended.held ? "away" : "ended" } as TemporaryRoleSettlement
            }
            let removed = false
            // A confirmed removal is evaluated once more, which closes the grant
            for (let step = 0; step < 2; step++) {
                const fresh = yield* roleMemberContext(client, serverId, current.userId, actorId)
                if (!fresh.context.roles.some((role) => role.roleId === current.roleId)) {
                    yield* store.work({ serverId, operation: { type: "end", ...binding, reason: "role" } })
                    return { state: "ended" } as TemporaryRoleSettlement
                }
                const result = yield* roles
                    .evaluate({
                        serverId,
                        sourceId: current.sourceId,
                        createdAt: yield* Clock.currentTimeMillis,
                        context: fresh.context,
                        operation: { type: "temporary", roleId: current.roleId },
                    })
                    .pipe(
                        Effect.catch((error) =>
                            error instanceof RolesStoreError &&
                            error.code !== undefined &&
                            Object.hasOwn(refusals, error.code)
                                ? Effect.succeed(refusals[error.code as keyof typeof refusals])
                                : Effect.fail(error),
                        ),
                    )
                if (typeof result === "string") return yield* problem(current, result)
                if (result.status === "blocked") return yield* problem(current, "uncertain")
                if (!result.grant) return { state: removed ? "removed" : "unchanged" } as TemporaryRoleSettlement
                const action = result.grant.action
                const outcome = yield* performRoleGrant(
                    roles,
                    serverId,
                    client,
                    result.grant,
                    actorId,
                    false,
                    action === "add" ? "Temporary role" : "Temporary role ended",
                )
                // Fluxer adds and removes 20 roles per server every 10 seconds, so a grant its limit held back is tried again once it allows
                if (outcome.outcome === "failed") return yield* problem(current, "refused", outcome.retryAfterMs)
                if (outcome.outcome !== "succeeded" || !outcome.acknowledged)
                    return yield* problem(current, "uncertain")
                if (action === "add") return { state: "added" } as TemporaryRoleSettlement
                removed = true
            }
            return { state: "removed" } as TemporaryRoleSettlement
        })
    return withRoleMember(client, grant.userId, settle(grant, false), serverId).pipe(
        Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause) ? Effect.failCause(cause) : problem(grant, "unavailable"),
        ),
    )
}

/**
 * Brings back the running temporary roles of a member who rejoined, once join protection let the join through. The join event is the
 * observation of the new membership, and the grants it moves are due at once for the worker it wakes, which settles each with a fresh member
 * read and the usual checks. The join settles none itself, so it never waits for the member's lock behind other role work, such as the
 * member's autoroles, and the joins after it never wait either. Answers whether the server has any grant left
 */
export function restoreTemporaryRoles(
    store: TemporaryRoleStore,
    serverId: string,
    userId: string,
    eventJoinedAt: string,
    wakeWorker: Effect.Effect<void> = Effect.void,
) {
    return Effect.gen(function* () {
        // The same freshness window as autorole, so a replayed old join moves nothing
        const joined = Date.parse(eventJoinedAt),
            now = yield* Clock.currentTimeMillis
        if (!Number.isFinite(joined) || joined > now + 60000 || joined < now - 900000) return undefined
        const rejoined = yield* store.work({
            serverId,
            operation: {
                type: "rejoin",
                userId,
                joinedAt: eventJoinedAt,
                originServerId: serverId,
                memberUserId: userId,
                observedAt: now,
            },
        })
        if (rejoined.type !== "grants") return undefined
        if (rejoined.grants.length) yield* wakeWorker
        return rejoined.held
    })
}

export function startTemporaryRoleWorker(
    store: TemporaryRoleStore,
    roles: RolesStore,
    serverId: string,
    client: Client,
) {
    return Effect.gen(function* () {
        // Every listed grant leaves the due list, by settling, ending or a problem with a later check, so the next page holds other grants
        const pass = Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const due = yield* store.work({ serverId, operation: { type: "list" } })
                if (due.type !== "grants" || !due.grants.length) return
                for (const grant of due.grants) yield* settleTemporaryRole(store, roles, serverId, client, grant)
                if (due.grants.length < 10) return
            }
        })
        const { wake } = yield* startSignalledWorker(
            pass,
            Effect.logWarning("Temporary roles could not be read. Due grants stay listed for the next check"),
        )
        // The work dispatcher wakes this worker once grants are due
        return { notify: () => wake }
    })
}
