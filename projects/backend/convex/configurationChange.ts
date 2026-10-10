import type { MutationCtx } from "./_generated/server.js"
import type { DashboardConfigurationFamily } from "@neonflux/contracts/dashboard"
import { auditedChange, type AuditActor } from "./auditLog.ts"
import { bumpConfigurationRevision } from "./configurationRevision.ts"
import { configurationData } from "./configurationSnapshot.ts"

export type ConfigurationChange = { kind: "chat" | "dashboard", createdAt: number, actor: AuditActor, operation: unknown }

// Every chat and website change to a configuration family runs through here. It applies the change, bumps the family
// revision and records the change in the audit log from the family's dashboard view before and after, so a new family
// or operation is recorded without code of its own
export function changeConfiguration<T>(ctx: MutationCtx, serverId: string, family: DashboardConfigurationFamily, change: ConfigurationChange, apply: () => Promise<T>): Promise<T> {
    return auditedChange(ctx, serverId, change.actor, family, change.operation, async () => (await configurationData(ctx, serverId, family)).data, async () => {
        const result = await apply()
        await bumpConfigurationRevision(ctx, serverId, family, change)
        return result
    })
}
