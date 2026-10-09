import type * as C from "@neonflux/backend/contracts"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Exit, Queue } from "effect"
import type { LevelingStore } from "./level-store.ts"
import type { RolesStore } from "./roles-store.ts"
import { roleMemberContext, performRoleGrant, withRoleMember } from "./roles.ts"
import { LevelingHandlingError } from "./leveling.ts"
import { readNativeMember } from "./member-evidence.ts"

// Applies one dirty account's mapped rewards through the role ownership ledger. Returns whether every target settled.
function applyLevelAccount(store: LevelingStore, roles: RolesStore, serverId: string, client: Client, account: C.LevelingRewardAccount) {
    return Effect.gen(function* () {
        // Typed absence is the only native failure that can clear departed membership references.
        const evidence = yield* readNativeMember(client, serverId, account.userId)
        const native = evidence.member
        let settled = true
        for (const ref of account.refs) {
            if (native && ref.joinedAt === native.joinedAt) continue
            const skipped = yield* store.work({ serverId, operation: { type: "skip", userId: account.userId, mark: account.mark, roleId: ref.roleId, joinedAt: ref.joinedAt,
                originServerId: evidence.originServerId, memberUserId: evidence.userId, observedAt: yield* Clock.currentTimeMillis,
                currentJoinedAt: native?.joinedAt ?? null, ...(!native ? { memberAbsent: true as const } : {}) } })
            if (skipped.type !== "progress" || !skipped.recorded) settled = false
        }
        if (!native) return settled
        for (const target of account.targets) {
            const fresh = yield* roleMemberContext(client, serverId, account.userId)
            if (fresh.context.joinedAt !== native.joinedAt) return false
            // One role's failure, such as a rejected unsafe role, keeps the account dirty without blocking later targets
            const applied = yield* Effect.exit(Effect.gen(function* () {
                const result = yield* roles.evaluate({ serverId, sourceId: target.sourceId, createdAt: yield* Clock.currentTimeMillis, context: fresh.context,
                    operation: { type: "level-sync", roleId: target.roleId } })
                if (result.status === "blocked") return false
                if (!result.grant) return true
                const outcome = yield* performRoleGrant(roles, serverId, client, result.grant)
                return outcome.outcome === "succeeded" && outcome.acknowledged
            }))
            if (Exit.isFailure(applied) && Cause.hasInterrupts(applied.cause)) return yield* Effect.failCause(applied.cause)
            if (!Exit.isSuccess(applied) || !applied.value) settled = false
        }
        return settled
    })
}

export function processLevelAccount(store: LevelingStore, roles: RolesStore, serverId: string, client: Client, account: C.LevelingRewardAccount) {
    return Effect.gen(function* () {
        const applied = yield* Effect.exit(withRoleMember(client, account.userId, applyLevelAccount(store, roles, serverId, client, account), serverId))
        if (Exit.isFailure(applied) && Cause.hasInterrupts(applied.cause)) return yield* Effect.failCause(applied.cause)
        // Only a fully settled pass clears the mark. Anything else defers this account and keeps it dirty.
        const complete = Exit.isSuccess(applied) && applied.value && account.complete
        yield* store.work({ serverId, operation: { type: "done", userId: account.userId, mark: account.mark, complete } })
    })
}

export function startLevelRoleWorker(store: LevelingStore, roles: RolesStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<true>({ capacity: 1, strategy: "dropping" })
        yield* Effect.addFinalizer(() => Queue.shutdown(queue))
        const notify = () => Queue.offer(queue, true).pipe(Effect.asVoid)
        const pass = Effect.gen(function* () {
            const page = yield* store.work({ serverId, operation: { type: "list" } })
            if (page.type !== "accounts") return yield* Effect.fail(new LevelingHandlingError({ stage: "work" }))
            for (const account of page.accounts) {
                yield* processLevelAccount(store, roles, serverId, client, account).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause) : Effect.logWarning("Level reward reconciliation deferred. Inspect !level status")))
            }
        })
        yield* Effect.gen(function* () {
            for (;;) {
                yield* Queue.take(queue)
                yield* pass.pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                    : Effect.logWarning("Level reward work could not be read. Dirty accounts remain marked")))
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
        // Credits wake this worker directly. The work dispatcher wakes it for deferred accounts and pending sweeps once they are due
        return { notify }
    })
}
