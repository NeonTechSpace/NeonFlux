import { SidebarDashboardOperation, SidebarOperation } from "@neonflux/contracts/sidebar"
import { decode } from "./validation.ts"

export const SIDEBAR_DEFAULT_NAME = "NeonFlux dashboard"

// Fluxer trims names itself, so a name is checked as given and used trimmed
export function sidebarOperation(value: unknown): SidebarOperation {
    const op = decode(SidebarOperation, value)
    return op.type === "remove" ? op : { ...op, name: op.name.trim() }
}
/** A dashboard add names the category instead of a channel, because the bot creates the channel when it applies the request */
export function dashboardSidebarOperation(value: unknown): SidebarDashboardOperation {
    const op = decode(SidebarDashboardOperation, value)
    return op.type === "remove" ? op : { ...op, name: op.name.trim() }
}
