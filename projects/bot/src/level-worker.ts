import type { LevelingRewardAccount } from "@neonflux/contracts/leveling"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Exit } from "effect"
import type { LevelingStore } from "./level-store.ts"
import type { RolesStore } from "./roles-store.ts"
import { roleMemberContext, performRoleGrant, withRoleMember } from "./roles.ts"
import { LevelingHandlingError } from "./leveling.ts"
import { readNativeMember } from "./member-evidence.ts"
import { startSignalledWorker } from "./signalled-worker.ts"
import { warnFailure } from "./contained.ts"

// Applies one dirty account's mapped rewards through the role ownership ledger. Returns whether every target settled, and whether
// the backend's refusal of a role evaluation is the only thing that left the account unsettled, which DEFCON can cause for additions
function applyLevelAccount(
    store: LevelingStore,
    roles: RolesStore,
    serverId: string,
    client: Client,
    account: LevelingRewardAccount,
) {
    return Effect.gen(function* () {
        // Typed absence is the only native failure that can clear departed membership references.
        const evidence = yield* readNativeMember(client, serverId, account.userId)
        const native = evidence.member
        let settled = true,
            other = false,
            refused = false
        for (const ref of account.refs) {
            if (native && ref.joinedAt === native.joinedAt) continue
            const skipped = yield* store.work({
                serverId,
                operation: {
                    type: "skip",
                    userId: account.userId,
                    mark: account.mark,
                    roleId: ref.roleId,
                    joinedAt: ref.joinedAt,
                    originServerId: evidence.originServerId,
                    memberUserId: evidence.userId,
                    observedAt: yield* Clock.currentTimeMillis,
                    currentJoinedAt: native?.joinedAt ?? null,
                    ...(!native ? { memberAbsent: true as const } : {}),
                },
            })
            if (skipped.type !== "progress" || !skipped.recorded) {
                settled = false
                other = true
            }
        }
        if (!native) return { settled, refused: false }
        // The member is read once, and again only after a role change ran, since a target that changes nothing on Fluxer
        // leaves the member as read. An account may earn every reward role, so this keeps a pass to a few reads
        let fresh: Effect.Success<ReturnType<typeof roleMemberContext>> | undefined
        for (const target of account.targets) {
            fresh ??= yield* roleMemberContext(client, serverId, account.userId)
            const context = fresh.context
            if (context.joinedAt !== native.joinedAt) return { settled: false, refused: false }
            let refusal = false
            // One role's failure, such as a rejected unsafe role, keeps the account dirty without blocking later targets
            const applied = yield* Effect.exit(
                Effect.gen(function* () {
                    const result = yield* roles
                        .evaluate({
                            serverId,
                            sourceId: target.sourceId,
                            createdAt: yield* Clock.currentTimeMillis,
                            context,
                            operation: { type: "level-sync", roleId: target.roleId },
                        })
                        .pipe(
                            Effect.tapError((error) =>
                                Effect.sync(() => {
                                    refusal = error.status === 403
                                }),
                            ),
                        )
                    if (result.status === "blocked") return false
                    if (!result.grant) return true
                    fresh = undefined
                    const outcome = yield* performRoleGrant(roles, serverId, client, result.grant)
                    return outcome.outcome === "succeeded" && outcome.acknowledged
                }),
            )
            if (Exit.isFailure(applied) && Cause.hasInterrupts(applied.cause))
                return yield* Effect.failCause(applied.cause)
            if (!Exit.isSuccess(applied) || !applied.value) {
                settled = false
                if (refusal && Exit.isFailure(applied)) refused = true
                else other = true
            }
        }
        return { settled, refused: refused && !other }
    })
}

export function processLevelAccount(
    store: LevelingStore,
    roles: RolesStore,
    serverId: string,
    client: Client,
    account: LevelingRewardAccount,
) {
    return Effect.gen(function* () {
        const applied = yield* Effect.exit(
            withRoleMember(
                client,
                account.userId,
                applyLevelAccount(store, roles, serverId, client, account),
                serverId,
            ),
        )
        if (Exit.isFailure(applied) && Cause.hasInterrupts(applied.cause)) return yield* Effect.failCause(applied.cause)
        // Only a fully settled pass clears the mark. Anything else defers this account and keeps it dirty.
        const complete = Exit.isSuccess(applied) && applied.value.settled && account.complete
        // The backend waits for DEFCON 3 only when it refused additions and nothing else, such as a removal or more retained
        // references than one pass lists, is left
        const held = Exit.isSuccess(applied) && applied.value.refused && account.complete
        yield* store.work({
            serverId,
            operation: {
                type: "done",
                userId: account.userId,
                mark: account.mark,
                complete,
                ...(held ? { held } : {}),
            },
        })
    })
}

export function startLevelRoleWorker(store: LevelingStore, roles: RolesStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const pass = Effect.gen(function* () {
            const page = yield* store.work({ serverId, operation: { type: "list" } })
            if (page.type !== "accounts") return yield* Effect.fail(new LevelingHandlingError({ stage: "work" }))
            for (const account of page.accounts) {
                yield* processLevelAccount(store, roles, serverId, client, account).pipe(
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : warnFailure("Level reward reconciliation deferred. Inspect !level status", cause),
                    ),
                )
            }
        })
        const { wake } = yield* startSignalledWorker(
            pass,
            Effect.logWarning("Level reward work could not be read. Dirty accounts remain marked"),
        )
        // Credits wake this worker directly. The work dispatcher wakes it for deferred accounts and pending sweeps once they are due
        return { notify: () => wake }
    })
}
