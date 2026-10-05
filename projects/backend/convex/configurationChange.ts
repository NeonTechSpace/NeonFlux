import type { MutationCtx } from "./_generated/server.js"
import type { DashboardConfigurationFamily } from "@neonflux/contracts/dashboard"
import { bumpConfigurationRevision } from "./configurationRevision.ts"

type ConfigurationChange = {
    kind: "chat" | "dashboard"
    createdAt: number
}

// Every chat and website change to a configuration family runs through here. It applies the change and bumps the family
// revision
export async function changeConfiguration<T>(
    ctx: MutationCtx,
    serverId: string,
    family: DashboardConfigurationFamily,
    change: ConfigurationChange,
    apply: () => Promise<T>,
): Promise<T> {
    const result = await apply()
    await bumpConfigurationRevision(ctx, serverId, family, change)
    return result
}
