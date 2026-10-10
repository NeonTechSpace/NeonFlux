import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { AlertInviteList, AlertSettings, AlertsResult } from "../contracts.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { changeConfiguration } from "./configurationChange.ts"
import { actor } from "./moderationDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, source } from "./validation.ts"
import { ALERT_EXPECTED_LIMIT, alertsOperation, defaultAlertSettings } from "./alertsDomain.ts"

type Read = QueryCtx | MutationCtx
export const readAlerts = (ctx: Read, serverId: string) => ctx.db.query("alertSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export const publicAlerts = (row: Doc<"alertSettings"> | null): AlertSettings => row ? { invites: row.invites, bots: row.bots, webhooks: row.webhooks, privileges: row.privileges,
    impersonation: row.impersonation, expectedBotIds: row.expectedBotIds, expectedWebhookIds: row.expectedWebhookIds } : defaultAlertSettings()
export const publicInviteList = (row: Doc<"alertSettings"> | null): AlertInviteList | null => row?.inviteList ?? null

// The bot reads the settings once when a server starts and keeps them in memory, so events of a server with every alert off cost no backend call
export const get = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<AlertsResult> => {
    return { settings: publicAlerts(await readAlerts(ctx, String(shape(request, ["serverId"], ["serverId"]).serverId))) }
} })

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<AlertsResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "managerAuthorized", "operation"], ["serverId", "messageId", "createdAt", "actor", "managerAuthorized", "operation"])
    const identity = source(input, Date.now()), who = actor(input.actor)
    if (input.managerAuthorized !== true || !who.nativePermissionAuthorized) fail(403, "Manage Server permission required")
    const op = alertsOperation(input.operation)
    return changeConfiguration(ctx, identity.serverId, "alerts", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
        async () => ({ settings: (await applyAlertsManagement(ctx, identity.serverId, who.userId, op)).settings }))
} })

/** Chat and dashboard share these rules. A dashboard invite job carries the list the bot read after its native work */
export async function applyAlertsManagement(ctx: MutationCtx, serverId: string, actorId: string, op: DashboardConfigurationOperationMap["alerts"] & { invites?: AlertInviteList }) {
    const row = await readAlerts(ctx, serverId), settings = publicAlerts(row)
    let patch: Partial<Doc<"alertSettings">> = {}
    if (op.type === "set") patch = { [op.alert]: op.enabled }
    else if (op.type === "expect") {
        const key = op.kind === "bot" ? "expectedBotIds" : "expectedWebhookIds", list = settings[key].filter(id => id !== op.id)
        if (op.expected) {
            if (list.length >= ALERT_EXPECTED_LIMIT) fail(429, `A server can mark at most ${ALERT_EXPECTED_LIMIT} expected ${op.kind}s`)
            list.push(op.id)
        }
        patch = { [key]: list }
    } else patch = { inviteList: op.invites! }
    const fields = { ...patch, updatedAt: Date.now(), updatedBy: actorId }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert("alertSettings", { serverId, ...defaultAlertSettings(), ...fields })
    const next = await readAlerts(ctx, serverId)
    return { settings: publicAlerts(next), invites: publicInviteList(next) }
}
