import type { AlertInvite, AlertInviteList, AlertKind, AlertSettings, AlertsOperation } from "../contracts.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { shape } from "./publishingDomain.ts"
import { bool, fail, integer, requireId } from "./validation.ts"

// Each server marks at most this many bots and webhooks as expected, and the dashboard keeps at most this many invites
export const ALERT_EXPECTED_LIMIT = 50, ALERT_INVITE_LIMIT = 100
export const alertKinds = ["invites", "bots", "webhooks", "privileges", "impersonation"] as const satisfies readonly AlertKind[]
export const defaultAlertSettings = (): AlertSettings => ({ invites: false, bots: false, webhooks: false, privileges: false, impersonation: false, expectedBotIds: [], expectedWebhookIds: [] })

export function alertsOperation(value: unknown): AlertsOperation
export function alertsOperation(value: unknown, dashboard: true): DashboardConfigurationOperationMap["alerts"]
export function alertsOperation(value: unknown, dashboard = false): DashboardConfigurationOperationMap["alerts"] {
    const raw = shape(value, ["type", "alert", "enabled", "kind", "id", "expected", "ref"], ["type"])
    if (raw.type === "set") {
        shape(raw, ["type", "alert", "enabled"], ["type", "alert", "enabled"])
        if (!alertKinds.includes(raw.alert as AlertKind)) fail(400, "Unknown alert")
        return { type: "set", alert: raw.alert as AlertKind, enabled: bool(raw.enabled) }
    }
    if (raw.type === "expect") {
        shape(raw, ["type", "kind", "id", "expected"], ["type", "kind", "id", "expected"])
        if (raw.kind !== "bot" && raw.kind !== "webhook") fail(400, "Expected entries are bots or webhooks")
        return { type: "expect", kind: raw.kind, id: requireId(raw.id), expected: bool(raw.expected) }
    }
    // Invite reads and revocations run natively in the bot, so only dashboard jobs carry them
    if (dashboard && raw.type === "invites-refresh") { shape(raw, ["type"], ["type"]); return { type: "invites-refresh" } }
    if (dashboard && raw.type === "invite-revoke") { shape(raw, ["type", "ref"], ["type", "ref"]); return { type: "invite-revoke", ref: inviteRef(raw.ref) } }
    fail(400, "Unknown alerts operation")
}

export function inviteRef(value: unknown) {
    if (typeof value !== "string" || !/^[a-f0-9]{16}$/.test(value)) fail(400, "Invalid invite reference")
    return value
}
const time = (value: unknown) => { if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) fail(400, "Invalid invite time"); return value }
/** The invite list the bot read for a dashboard job. It holds no invite codes */
export function alertInviteList(value: unknown, readAt: number): AlertInviteList {
    const input = shape(value, ["invites", "more"], ["invites", "more"])
    if (!Array.isArray(input.invites) || input.invites.length > ALERT_INVITE_LIMIT) fail(400, "Invalid invite list")
    const invites = input.invites.map((item): AlertInvite => {
        const r = shape(item, ["ref", "channelId", "inviterId", "uses", "maxUses", "expiresAt", "createdAt", "temporary"], ["ref", "channelId", "inviterId", "uses", "maxUses", "expiresAt", "createdAt", "temporary"])
        return { ref: inviteRef(r.ref), channelId: requireId(r.channelId), inviterId: r.inviterId === null ? null : requireId(r.inviterId), uses: integer(r.uses, 0, 2147483647),
            maxUses: integer(r.maxUses, 0, 2147483647), expiresAt: r.expiresAt === null ? null : time(r.expiresAt), createdAt: time(r.createdAt), temporary: bool(r.temporary) }
    })
    if (new Set(invites.map(invite => invite.ref)).size !== invites.length) fail(400, "Duplicate invite")
    return { readAt, invites, more: bool(input.more) }
}
