import type { SidebarOperation } from "../contracts.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { shape } from "./publishingDomain.ts"
import { fail, requireId } from "./validation.ts"

export const SIDEBAR_DEFAULT_NAME = "NeonFlux dashboard"

// Fluxer removes U+000C and U+202E and trims names before its own 1 to 100 code unit check
export function sidebarName(value: unknown): string {
    if (typeof value !== "string" || value.length > 100 || !value.replace(/[\u000c‮]/g, "").trim()) fail(400, "Link names need 1 to 100 characters")
    return value.trim()
}
export function sidebarOperation(value: unknown): SidebarOperation {
    const raw = shape(value, ["type", "channelId", "name"], ["type"])
    if (raw.type === "add") { shape(raw, ["type", "channelId", "name"], ["type", "channelId", "name"]); return { type: "add", channelId: requireId(raw.channelId), name: sidebarName(raw.name) } }
    if (raw.type === "set") { shape(raw, ["type", "name"], ["type", "name"]); return { type: "set", name: sidebarName(raw.name) } }
    if (raw.type === "remove") { shape(raw, ["type"]); return { type: "remove" } }
    return fail(400, "Unknown dashboard link operation")
}
/** A dashboard add names the category instead of a channel, because the bot creates the channel when it applies the request */
export function dashboardSidebarOperation(value: unknown): DashboardConfigurationOperationMap["sidebar"] {
    const raw = shape(value, ["type", "name", "categoryId"], ["type"])
    if (raw.type !== "add") return sidebarOperation(raw) as Exclude<SidebarOperation, { type: "add" }>
    shape(raw, ["type", "name", "categoryId"], ["type", "name", "categoryId"])
    return { type: "add", name: sidebarName(raw.name), categoryId: raw.categoryId === null ? null : requireId(raw.categoryId) }
}
