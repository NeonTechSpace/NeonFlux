import type { MutationCtx } from "./_generated/server.js"
import type { DashboardConfigurationFamily } from "@neonflux/contracts/dashboard"
import { auditedChange } from "./auditLog.ts"
import type { AuditActor } from "./validation.ts"
import { bumpConfigurationRevision } from "./configurationRevision.ts"
import { configurationData, type AuditFocus } from "./configurationSnapshot.ts"
import { eventSettings } from "./eventsStore.ts"
import { scheduleSettings } from "./schedulesStore.ts"

export type ConfigurationChange = {
    kind: "chat" | "dashboard"
    createdAt: number
    actor: AuditActor
    operation: unknown
}

/**
 * The entries of a family's long lists that an operation changes, which have no bound on their count: Watchlist entries by
 * member, drafts and templates by kind and name, and events and schedules by number. A create takes the next number
 */
async function auditFocus(
    ctx: MutationCtx,
    serverId: string,
    family: DashboardConfigurationFamily,
    operation: unknown,
): Promise<AuditFocus> {
    const op = (operation ?? {}) as Record<string, unknown>
    const text = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : undefined)
    switch (family) {
        case "moderation":
            return (op.type === "watchlist-add" || op.type === "watchlist-remove") && typeof op.userId === "string"
                ? { watchlist: [op.userId] }
                : {}
        case "publishing": {
            const named = [
                [text(op.kind), text(op.name)],
                [text(op.toKind), text(op.toName)],
            ].filter((pair): pair is [string, string] => pair[0] !== undefined && pair[1] !== undefined)
            return named.length ? { drafts: named } : {}
        }
        case "events":
            if (typeof op.eventNo === "number") return { events: [op.eventNo] }
            return op.type === "create" ? { events: [(await eventSettings(ctx, serverId))?.nextEventNo ?? 1] } : {}
        case "schedules":
            if (typeof op.scheduleNo === "number") return { schedules: [op.scheduleNo] }
            return op.type === "create"
                ? { schedules: [(await scheduleSettings(ctx, serverId))?.nextScheduleNo ?? 1] }
                : {}
        default:
            return {}
    }
}

// Every chat and website change to a configuration family runs through here. It applies the change, bumps the family
// revision and records the change in the audit log from the family's dashboard view before and after, so a new family
// or operation is recorded without code of its own
export async function changeConfiguration<T>(
    ctx: MutationCtx,
    serverId: string,
    family: DashboardConfigurationFamily,
    change: ConfigurationChange,
    apply: () => Promise<T>,
): Promise<T> {
    const focus = await auditFocus(ctx, serverId, family, change.operation)
    return auditedChange(
        ctx,
        serverId,
        change.actor,
        family,
        change.operation,
        async () => {
            const data: Record<string, unknown> = (await configurationData(ctx, serverId, family, {}, true, focus)).data
            // A focused list holds only the named entries, so one without them is left out rather than read as an emptied list
            for (const list of Object.keys(focus))
                if (Array.isArray(data[list]) && !data[list].length) delete data[list]
            return data
        },
        async () => {
            const result = await apply()
            await bumpConfigurationRevision(ctx, serverId, family, change)
            return result
        },
    )
}
