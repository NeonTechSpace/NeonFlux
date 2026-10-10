import { SidebarDashboardOperation, SidebarOperation } from "@neonflux/contracts/sidebar"
import { decode } from "./validation.ts"

// Fluxer trims names itself, so a name is checked as given and used trimmed
export function sidebarOperation(op: SidebarOperation): SidebarOperation {
    return op.type === "remove" ? op : { ...op, name: op.name.trim() }
}
/** A dashboard add names the category instead of a channel, because the bot creates the channel when it applies the request */
export function dashboardSidebarOperation(value: unknown): SidebarDashboardOperation {
    const op = decode(SidebarDashboardOperation, value)
    return op.type === "remove" ? op : { ...op, name: op.name.trim() }
}
