import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Exit } from "effect"
import type { RolesStore } from "./roles-store.ts"
import { rolePickerDisplay, type RolePickerStore } from "./rolepicker-store.ts"
import { evaluateRoleRequest, roleMemberContext, withRoleMember } from "./roles.ts"

// Website member requests from the dashboard job queue. The bot reads the member fresh, the backend decides with the current menus,
// access lists and role rules, and role writes use the shared role lifecycle with one-time claims and no replay of uncertain outcomes
export function processRolePickerPass(store: RolePickerStore, roles: RolesStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const ready = yield* store.ready({ serverId })
        for (const job of ready.jobs) yield* withRoleMember(client, job.actorId, Effect.gen(function* () {
            if ((yield* Clock.currentTimeMillis) >= job.expiresAt) return
            // The same fresh read supplies the server's role names, which the backend keeps for menu roles only
            const fresh = yield* roleMemberContext(client, serverId, job.actorId)
            const started = yield* store.start({ serverId, jobId: job.id, actorId: job.actorId, context: fresh.context, display: rolePickerDisplay(serverId, fresh.authority.roles) })
            const operation = started.job.operation
            // Lookups finish at start with the member's role IDs. Refused requests are already recorded with their reason
            if (!started.proceed || operation.type === "lookup") return
            const applied = yield* Effect.exit(evaluateRoleRequest(roles, serverId, client, { sourceId: `picker_${job.id}`, createdAt: job.createdAt }, job.actorId,
                { type: "pick", jobId: job.id, menu: operation.menu, roleId: operation.roleId, selected: operation.type === "claim" }, job.actorId, false, fresh.context.joinedAt, undefined, fresh))
            if (Exit.isFailure(applied) && Cause.hasInterrupts(applied.cause)) return yield* Effect.failCause(applied.cause)
            // The backend decides applied or failed from the member's roles after the change and the recorded attempts
            const after = yield* roleMemberContext(client, serverId, job.actorId)
            yield* store.complete({ serverId, jobId: job.id, actorId: job.actorId, context: after.context, display: rolePickerDisplay(serverId, after.authority.roles) })
        }), serverId).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
            : store.fail({ serverId, jobId: job.id }).pipe(Effect.catch(() => Effect.void))))
    })
}
