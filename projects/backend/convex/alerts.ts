import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import {
    ALERT_EXPECTED_LIMIT,
    alertActions,
    AlertsActionClaimRequest,
    AlertsActionOutcomeRequest,
    AlertsActionsObserveRequest,
    AlertsGetRequest,
    AlertsManageRequest,
    type AlertActionOutcome,
    type AlertInviteList,
    type AlertSettings,
    type AlertsActionClaimResult,
    type AlertsActionOutcomeResult,
    type AlertsActionsObserveResult,
    type AlertsDashboardOperation,
    type AlertsResult,
} from "@neonflux/contracts/alerts"
import type { MetadataLogsEvent } from "@neonflux/contracts/metadata-logs"
import { changeConfiguration } from "./configurationChange.ts"
import { actor, administrator } from "./moderationDomain.ts"
import { decode, fail, source } from "./validation.ts"
import { defaultAlertSettings } from "./alertsDomain.ts"
import { admitMetadata } from "./metadataLogsStore.ts"
import { metadataEvent } from "./metadataLogsDomain.ts"

// An action row only stops a redelivered event from acting twice, and the posted record keeps the result
const ALERT_ACTION_TTL_MS = 86400000
const ALERT_ACTION_BATCH = 100

type Read = QueryCtx | MutationCtx
export const readAlerts = (ctx: Read, serverId: string) =>
    ctx.db
        .query("alertSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const publicAlerts = (row: Doc<"alertSettings"> | null): AlertSettings =>
    row
        ? {
              invites: row.invites,
              bots: row.bots,
              webhooks: row.webhooks,
              privileges: row.privileges,
              impersonation: row.impersonation,
              kickBots: row.kickBots ?? false,
              deleteWebhooks: row.deleteWebhooks ?? false,
              removePermissions: row.removePermissions ?? false,
              expectedBotIds: row.expectedBotIds,
              expectedWebhookIds: row.expectedWebhookIds,
          }
        : defaultAlertSettings()
export const publicInviteList = (row: Doc<"alertSettings"> | null): AlertInviteList | null => row?.inviteList ?? null

// The bot reads the settings once when a server starts and keeps them in memory, so events of a server with every alert off cost no backend call
export const get = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AlertsResult> => {
        return { settings: publicAlerts(await readAlerts(ctx, decode(AlertsGetRequest, request).serverId)) }
    },
})

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AlertsResult> => {
        const input = decode(AlertsManageRequest, request)
        const identity = source(input, Date.now()),
            who = actor(input.actor),
            op = input.operation
        if (!who.nativePermissionAuthorized) fail(403, "Manage community permission required")
        // An action spends NeonFlux's own permissions, so only the owner or an Administrator turns one on
        if (op.type === "action" && op.enabled && !administrator(who))
            fail(403, "Owner or Administrator permission required")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "alerts",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: op,
            },
            async () => ({ settings: (await applyAlertsManagement(ctx, identity.serverId, who.userId, op)).settings }),
        )
    },
})

/** Chat and dashboard share these rules. A dashboard invite job carries the list the bot read after its native work */
export async function applyAlertsManagement(
    ctx: MutationCtx,
    serverId: string,
    actorId: string,
    op: AlertsDashboardOperation & { invites?: AlertInviteList },
) {
    const row = await readAlerts(ctx, serverId),
        settings = publicAlerts(row)
    let patch: Partial<Doc<"alertSettings">> = {}
    if (op.type === "set") patch = { [op.alert]: op.enabled }
    else if (op.type === "action") patch = { [op.action]: op.enabled }
    else if (op.type === "expect") {
        const key = op.kind === "bot" ? "expectedBotIds" : "expectedWebhookIds",
            list = settings[key].filter((id) => id !== op.id)
        if (op.expected) {
            // The list is one stored array, which Convex limits to 8,192 values
            if (list.length >= ALERT_EXPECTED_LIMIT)
                fail(
                    429,
                    `A server can mark up to ${ALERT_EXPECTED_LIMIT.toLocaleString("en-US")} expected ${op.kind}s`,
                )
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

/** Admits the security record of an action's outcome. Its source is derived from the action's key, so it is admitted once */
async function recordAction(ctx: MutationCtx, row: Doc<"alertActions">, outcome: AlertActionOutcome) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${row.serverId}\n${row.key}`))
    const sessionId = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("")
    const event: MetadataLogsEvent = {
        category: "security",
        type: "alert-action",
        source: { kind: "observation", sessionId, sequence: 1 },
        observedAt: Date.now(),
        actor: { kind: "unknown" },
        resourceIds: [row.targetId],
        changedFields: [alertActions[row.action].record, outcome, ...(row.permissions ?? [])],
        count: 1,
        outcome: "observed",
    }
    return (await admitMetadata(ctx, row.serverId, metadataEvent(event, true))).admitted
}
const readAction = (ctx: Read, serverId: string, key: string) =>
    ctx.db
        .query("alertActions")
        .withIndex("by_server_key", (q) => q.eq("serverId", serverId).eq("key", key))
        .unique()

/**
 * The bot claims an action before its native call. A known key claims nothing, and the backend rechecks that the action and
 * its alert are on and that neither the target nor the actor is expected
 */
export const claimAction = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AlertsActionClaimResult> => {
        const input = decode(AlertsActionClaimRequest, request),
            settings = publicAlerts(await readAlerts(ctx, input.serverId)),
            expectedBot = (id: string | undefined) => id !== undefined && settings.expectedBotIds.includes(id)
        if (
            !settings[input.action] ||
            !settings[alertActions[input.action].alert] ||
            expectedBot(input.actorId) ||
            (input.action === "kickBots" && expectedBot(input.targetId)) ||
            (input.action === "deleteWebhooks" && settings.expectedWebhookIds.includes(input.targetId)) ||
            (await readAction(ctx, input.serverId, input.key))
        )
            return { claimed: false }
        const now = Date.now()
        await ctx.db.insert("alertActions", {
            serverId: input.serverId,
            key: input.key,
            action: input.action,
            targetId: input.targetId,
            ...(input.permissions ? { permissions: input.permissions } : {}),
            outcome: "pending",
            createdAt: now,
            expiresAt: now + ALERT_ACTION_TTL_MS,
        })
        return { claimed: true }
    },
})

/** Records a claimed action's outcome once, with its security record */
export const actionOutcome = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AlertsActionOutcomeResult> => {
        const input = decode(AlertsActionOutcomeRequest, request),
            row = await readAction(ctx, input.serverId, input.key)
        if (row?.outcome !== "pending") return { recorded: false, admitted: false }
        await ctx.db.patch(row._id, { outcome: input.outcome })
        return { recorded: true, admitted: await recordAction(ctx, row, input.outcome) }
    },
})

/** At startup, an action the previous process claimed but never finished may or may not have happened, so it becomes uncertain */
export const observeActions = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AlertsActionsObserveResult> => {
        const { serverId } = decode(AlertsActionsObserveRequest, request)
        const rows = await ctx.db
            .query("alertActions")
            .withIndex("by_server_outcome", (q) => q.eq("serverId", serverId).eq("outcome", "pending"))
            .take(ALERT_ACTION_BATCH)
        let admitted = false
        for (const row of rows) {
            await ctx.db.patch(row._id, { outcome: "uncertain" })
            admitted = (await recordAction(ctx, row, "uncertain")) || admitted
        }
        return { uncertain: rows.length, admitted }
    },
})

/** Retention deletes action rows after 24 hours */
export async function cleanupAlertActions(ctx: MutationCtx, now: number) {
    const rows = await ctx.db
        .query("alertActions")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(ALERT_ACTION_BATCH)
    for (const row of rows) await ctx.db.delete(row._id)
    return { more: rows.length === ALERT_ACTION_BATCH }
}
